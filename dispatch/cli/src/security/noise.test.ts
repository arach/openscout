import { test, expect } from "bun:test";
import { NoiseHandshake, generateKeyPair } from "./noise.ts";

test("XX handshake — mutual authentication and encrypted transport", () => {
  const aliceStatic = generateKeyPair();
  const bobStatic = generateKeyPair();

  const alice = new NoiseHandshake("XX", "initiator", aliceStatic);
  const bob = new NoiseHandshake("XX", "responder", bobStatic);

  // Message 1: Alice → Bob (→ e)
  expect(alice.isMySend()).toBe(true);
  const msg1 = alice.writeMessage();
  const payload1 = bob.readMessage(msg1);
  expect(payload1.length).toBe(0);

  // Message 2: Bob → Alice (← e, ee, s, es)
  expect(bob.isMySend()).toBe(true);
  const msg2 = bob.writeMessage();
  const payload2 = alice.readMessage(msg2);
  expect(payload2.length).toBe(0);

  // Message 3: Alice → Bob (→ s, se)
  expect(alice.isMySend()).toBe(true);
  const msg3 = alice.writeMessage(new TextEncoder().encode("hello from alice"));
  const payload3 = bob.readMessage(msg3);
  expect(new TextDecoder().decode(payload3)).toBe("hello from alice");

  // Both sides complete.
  expect(alice.isComplete()).toBe(true);
  expect(bob.isComplete()).toBe(true);

  // Finalize into transport sessions.
  const aliceSession = alice.finalize();
  const bobSession = bob.finalize();

  // Both learned each other's static keys.
  expect(aliceSession.remoteStaticKey).toEqual(bobStatic.publicKey);
  expect(bobSession.remoteStaticKey).toEqual(aliceStatic.publicKey);

  // Handshake hashes match (channel binding).
  expect(aliceSession.handshakeHash).toEqual(bobSession.handshakeHash);

  // Encrypted transport: Alice → Bob.
  const plaintext = new TextEncoder().encode('{"method":"prompt/send","params":{}}');
  const ciphertext = aliceSession.encrypt(plaintext);
  expect(ciphertext).not.toEqual(plaintext);
  const decrypted = bobSession.decrypt(ciphertext);
  expect(decrypted).toEqual(plaintext);

  // Encrypted transport: Bob → Alice.
  const response = new TextEncoder().encode('{"event":"turn:start"}');
  const encResponse = bobSession.encrypt(response);
  const decResponse = aliceSession.decrypt(encResponse);
  expect(decResponse).toEqual(response);
});

test("IK handshake — trusted reconnect (initiator knows responder key)", () => {
  const phoneStatic = generateKeyPair();
  const bridgeStatic = generateKeyPair();

  // Phone already knows the bridge's public key from previous pairing.
  const phone = new NoiseHandshake("IK", "initiator", phoneStatic, bridgeStatic.publicKey);
  const bridge = new NoiseHandshake("IK", "responder", bridgeStatic);

  // Message 1: Phone → Bridge (→ e, es, s, ss)
  const msg1 = phone.writeMessage();
  bridge.readMessage(msg1);

  // Message 2: Bridge → Phone (← e, ee, se)
  const msg2 = bridge.writeMessage(new TextEncoder().encode("welcome back"));
  const payload = phone.readMessage(msg2);
  expect(new TextDecoder().decode(payload)).toBe("welcome back");

  expect(phone.isComplete()).toBe(true);
  expect(bridge.isComplete()).toBe(true);

  const phoneSession = phone.finalize();
  const bridgeSession = bridge.finalize();

  // Mutual key knowledge.
  expect(phoneSession.remoteStaticKey).toEqual(bridgeStatic.publicKey);
  expect(bridgeSession.remoteStaticKey).toEqual(phoneStatic.publicKey);

  // Bidirectional encrypted transport.
  const msg = new TextEncoder().encode("test");
  expect(bridgeSession.decrypt(phoneSession.encrypt(msg))).toEqual(msg);
  expect(phoneSession.decrypt(bridgeSession.encrypt(msg))).toEqual(msg);
});

test("encrypted messages are not replayable (nonce increments)", () => {
  const a = generateKeyPair();
  const b = generateKeyPair();

  const ha = new NoiseHandshake("XX", "initiator", a);
  const hb = new NoiseHandshake("XX", "responder", b);

  hb.readMessage(ha.writeMessage());
  ha.readMessage(hb.writeMessage());
  hb.readMessage(ha.writeMessage());

  const sa = ha.finalize();
  const sb = hb.finalize();

  const msg = new TextEncoder().encode("secret");
  const ct1 = sa.encrypt(msg);
  const ct2 = sa.encrypt(msg);

  // Same plaintext, different ciphertext (nonce changed).
  expect(ct1).not.toEqual(ct2);

  // Both decrypt correctly in order.
  expect(sb.decrypt(ct1)).toEqual(msg);
  expect(sb.decrypt(ct2)).toEqual(msg);
});
