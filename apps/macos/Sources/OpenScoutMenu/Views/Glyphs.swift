import SwiftUI

// Hand-drawn cockpit glyphs. Each shape is normalized to a 14×14 design grid
// and stroked at 1px so it reads at the same weight as the surrounding mono
// type. Stroke color comes from `.foregroundStyle(...)` on the call site —
// the shapes never bake in a color of their own.

private let glyphGrid: CGFloat = 14

private func mapped(_ point: CGPoint, in rect: CGRect) -> CGPoint {
    CGPoint(
        x: rect.minX + point.x / glyphGrid * rect.width,
        y: rect.minY + point.y / glyphGrid * rect.height
    )
}

// MARK: - Broker

/// Hub-and-spoke. Central node + four radiating dots on the cardinal axes.
struct BrokerGlyph: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        let center = CGPoint(x: 7, y: 7)
        let satellites: [CGPoint] = [
            CGPoint(x: 7, y: 1.5),
            CGPoint(x: 12.5, y: 7),
            CGPoint(x: 7, y: 12.5),
            CGPoint(x: 1.5, y: 7),
        ]
        for s in satellites {
            path.move(to: mapped(center, in: rect))
            path.addLine(to: mapped(s, in: rect))
        }
        let nodeRadius: CGFloat = max(rect.width / glyphGrid * 1.6, 1.4)
        let satRadius: CGFloat = max(rect.width / glyphGrid * 0.9, 1.0)
        let centerPt = mapped(center, in: rect)
        path.addEllipse(in: CGRect(
            x: centerPt.x - nodeRadius,
            y: centerPt.y - nodeRadius,
            width: nodeRadius * 2,
            height: nodeRadius * 2
        ))
        for s in satellites {
            let p = mapped(s, in: rect)
            path.addEllipse(in: CGRect(
                x: p.x - satRadius,
                y: p.y - satRadius,
                width: satRadius * 2,
                height: satRadius * 2
            ))
        }
        return path
    }
}

// MARK: - Mesh

/// Three nodes wired into a triangle.
struct MeshGlyph: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        let nodes: [CGPoint] = [
            CGPoint(x: 7, y: 1.8),
            CGPoint(x: 1.8, y: 11.5),
            CGPoint(x: 12.2, y: 11.5),
        ]
        let points = nodes.map { mapped($0, in: rect) }
        path.move(to: points[0])
        path.addLine(to: points[1])
        path.addLine(to: points[2])
        path.closeSubpath()
        let radius: CGFloat = max(rect.width / glyphGrid * 1.3, 1.3)
        for p in points {
            path.addEllipse(in: CGRect(
                x: p.x - radius,
                y: p.y - radius,
                width: radius * 2,
                height: radius * 2
            ))
        }
        return path
    }
}

// MARK: - Web

/// Three-band globe. One vertical ellipse + two horizontal arcs and an
/// outer circle.
struct WebGlyph: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        let inset: CGFloat = rect.width / glyphGrid * 1.5
        let bounds = rect.insetBy(dx: inset, dy: inset)
        path.addEllipse(in: bounds)
        path.addEllipse(in: bounds.insetBy(dx: bounds.width * 0.32, dy: 0))
        let midY = bounds.midY
        path.move(to: CGPoint(x: bounds.minX, y: midY))
        path.addLine(to: CGPoint(x: bounds.maxX, y: midY))
        let upperY = bounds.minY + bounds.height * 0.28
        let lowerY = bounds.minY + bounds.height * 0.72
        path.move(to: CGPoint(x: bounds.minX + bounds.width * 0.10, y: upperY))
        path.addLine(to: CGPoint(x: bounds.maxX - bounds.width * 0.10, y: upperY))
        path.move(to: CGPoint(x: bounds.minX + bounds.width * 0.10, y: lowerY))
        path.addLine(to: CGPoint(x: bounds.maxX - bounds.width * 0.10, y: lowerY))
        return path
    }
}

// MARK: - Peers

/// Cluster of four small dots, slightly off-grid for a hand-drawn feel.
struct PeersGlyph: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        let dots: [CGPoint] = [
            CGPoint(x: 4.0, y: 4.5),
            CGPoint(x: 9.5, y: 3.8),
            CGPoint(x: 4.5, y: 10.0),
            CGPoint(x: 10.0, y: 9.5),
        ]
        let radius: CGFloat = max(rect.width / glyphGrid * 1.3, 1.3)
        for d in dots {
            let p = mapped(d, in: rect)
            path.addEllipse(in: CGRect(
                x: p.x - radius,
                y: p.y - radius,
                width: radius * 2,
                height: radius * 2
            ))
        }
        return path
    }
}

// MARK: - Relay

/// Two endpoint dots with a flowing dashed line between them.
struct RelayGlyph: View {
    var body: some View {
        GeometryReader { proxy in
            let rect = CGRect(origin: .zero, size: proxy.size)
            let left = mapped(CGPoint(x: 2.0, y: 7), in: rect)
            let right = mapped(CGPoint(x: 12.0, y: 7), in: rect)
            let radius: CGFloat = max(rect.width / glyphGrid * 1.4, 1.4)

            ZStack {
                Path { path in
                    path.move(to: left)
                    path.addLine(to: right)
                }
                .stroke(style: StrokeStyle(lineWidth: 1, lineCap: .round, dash: [2, 2]))

                Path { path in
                    path.addEllipse(in: CGRect(
                        x: left.x - radius,
                        y: left.y - radius,
                        width: radius * 2,
                        height: radius * 2
                    ))
                    path.addEllipse(in: CGRect(
                        x: right.x - radius,
                        y: right.y - radius,
                        width: radius * 2,
                        height: radius * 2
                    ))
                }
                .fill()
            }
        }
    }
}

// MARK: - Adoption helper

/// Standard call site: glyph at 14pt, 1.5px stroke, tinted by `color`.
struct ServiceGlyph: View {
    enum Kind {
        case broker, mesh, web, peers, relay
    }

    let kind: Kind
    var size: CGFloat = 14
    var lineWidth: CGFloat = 1.5
    var color: Color = ShellPalette.ink

    var body: some View {
        Group {
            switch kind {
            case .broker:
                BrokerGlyph().stroke(color, lineWidth: lineWidth)
            case .mesh:
                MeshGlyph().stroke(color, lineWidth: lineWidth)
            case .web:
                WebGlyph().stroke(color, lineWidth: lineWidth)
            case .peers:
                PeersGlyph().fill(color)
            case .relay:
                RelayGlyph().foregroundStyle(color)
            }
        }
        .frame(width: size, height: size)
    }

    static func kind(forServiceID id: String) -> Kind {
        switch id {
        case "broker": return .broker
        case "relay":  return .relay
        case "web":    return .web
        case "peers":  return .peers
        case "mesh":   return .mesh
        default:       return .broker
        }
    }
}
