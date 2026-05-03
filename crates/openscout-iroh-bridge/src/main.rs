use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    time::Duration,
};

use anyhow::{Context, Result};
use clap::{Parser, Subcommand};
use data_encoding::HEXLOWER;
use iroh::{Endpoint, SecretKey, endpoint::presets};
use serde::Serialize;

const OPENSCOUT_MESH_PROTOCOL_VERSION: u8 = 1;
const OPENSCOUT_IROH_MESH_ALPN: &[u8] = b"openscout/mesh/0";

#[derive(Debug, Parser)]
#[command(name = "openscout-iroh-bridge")]
#[command(about = "Iroh sidecar for OpenScout Mesh")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Debug, Subcommand)]
enum Command {
    /// Load or create the node's Iroh identity and print public metadata.
    Identity {
        #[arg(long)]
        identity_path: PathBuf,
    },
    /// Bind an Iroh endpoint, print its current address, and wait until stopped.
    Serve {
        #[arg(long)]
        identity_path: PathBuf,
        #[arg(long, default_value_t = 5_000)]
        online_timeout_ms: u64,
    },
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct IdentityOutput {
    bridge_protocol_version: u8,
    alpn: String,
    endpoint_id: String,
    identity_path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ServeOutput {
    bridge_protocol_version: u8,
    alpn: String,
    endpoint_id: String,
    endpoint_addr: serde_json::Value,
    identity_path: String,
}

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();
    match cli.command {
        Command::Identity { identity_path } => {
            let secret_key = load_or_create_secret_key(&identity_path)?;
            print_json(&IdentityOutput {
                bridge_protocol_version: OPENSCOUT_MESH_PROTOCOL_VERSION,
                alpn: alpn_string(),
                endpoint_id: secret_key.public().to_string(),
                identity_path: identity_path.display().to_string(),
            })?;
        }
        Command::Serve {
            identity_path,
            online_timeout_ms,
        } => {
            let secret_key = load_or_create_secret_key(&identity_path)?;
            let endpoint = Endpoint::builder(presets::N0)
                .secret_key(secret_key.clone())
                .alpns(vec![OPENSCOUT_IROH_MESH_ALPN.to_vec()])
                .bind()
                .await
                .context("bind iroh endpoint")?;

            let _ = tokio::time::timeout(
                Duration::from_millis(online_timeout_ms),
                endpoint.online(),
            )
            .await;

            print_json(&ServeOutput {
                bridge_protocol_version: OPENSCOUT_MESH_PROTOCOL_VERSION,
                alpn: alpn_string(),
                endpoint_id: secret_key.public().to_string(),
                endpoint_addr: serde_json::to_value(endpoint.addr())
                    .context("serialize endpoint address")?,
                identity_path: identity_path.display().to_string(),
            })?;

            tokio::signal::ctrl_c().await.context("wait for shutdown")?;
            endpoint.close().await;
        }
    }

    Ok(())
}

fn alpn_string() -> String {
    String::from_utf8_lossy(OPENSCOUT_IROH_MESH_ALPN).into_owned()
}

fn print_json(value: &impl Serialize) -> Result<()> {
    println!(
        "{}",
        serde_json::to_string_pretty(value).context("serialize output")?
    );
    Ok(())
}

fn load_or_create_secret_key(path: &Path) -> Result<SecretKey> {
    if path.exists() {
        return load_secret_key(path);
    }

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("create identity directory {}", parent.display()))?;
    }

    let secret_key = SecretKey::generate();
    let encoded = HEXLOWER.encode(&secret_key.to_bytes());
    write_identity(path, &encoded)?;
    Ok(secret_key)
}

fn load_secret_key(path: &Path) -> Result<SecretKey> {
    let raw = fs::read_to_string(path)
        .with_context(|| format!("read identity {}", path.display()))?;
    let trimmed = raw.trim();
    let bytes = HEXLOWER
        .decode(trimmed.as_bytes())
        .with_context(|| format!("decode identity {}", path.display()))?;
    let bytes: [u8; 32] = bytes
        .try_into()
        .map_err(|_| anyhow::anyhow!("identity {} must decode to 32 bytes", path.display()))?;
    Ok(SecretKey::from_bytes(&bytes))
}

#[cfg(unix)]
fn write_identity(path: &Path, encoded: &str) -> Result<()> {
    use std::os::unix::fs::OpenOptionsExt;

    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true).mode(0o600);
    let mut file = options.open(path)?;
    file.write_all(encoded.as_bytes())
        .with_context(|| format!("write identity {}", path.display()))?;
    Ok(())
}

#[cfg(not(unix))]
fn write_identity(path: &Path, encoded: &str) -> Result<()> {
    fs::write(path, encoded).with_context(|| format!("write identity {}", path.display()))?;
    Ok(())
}
