// Renders the simulated demo panel to a PNG with WebKit, so the README
// preview can be regenerated without the external browser CLI the other
// design scripts expect. Never opens Photoshop or touches a real project.
// Serve the plugin folder first, e.g.
//   python3 -m http.server 8766 --bind 127.0.0.1 --directory apps/photoshop-plugin
// then: swift scripts/render-panel-preview.swift <url> <width> <height> <out.png>
import AppKit
import WebKit

let args = CommandLine.arguments
guard args.count == 5, let w = Int(args[2]), let h = Int(args[3]) else {
  fputs("usage: shot.swift <url> <width> <height> <out.png>\n", stderr); exit(64)
}
let url = URL(string: args[1])!, out = URL(fileURLWithPath: args[4])

let app = NSApplication.shared
app.setActivationPolicy(.accessory)

let config = WKWebViewConfiguration()
let view = WKWebView(frame: NSRect(x: 0, y: 0, width: w, height: h), configuration: config)

final class Waiter: NSObject, WKNavigationDelegate {
  var done = false
  func webView(_ w: WKWebView, didFinish n: WKNavigation!) { done = true }
  func webView(_ w: WKWebView, didFail n: WKNavigation!, withError e: Error) { done = true }
}
let waiter = Waiter()
view.navigationDelegate = waiter
view.load(URLRequest(url: url))

let deadline = Date().addingTimeInterval(25)
while !waiter.done && Date() < deadline { RunLoop.current.run(mode: .default, before: Date().addingTimeInterval(0.05)) }
// Let the panel's scripts render and settle.
let settle = Date().addingTimeInterval(4)
while Date() < settle { RunLoop.current.run(mode: .default, before: Date().addingTimeInterval(0.05)) }

let cfg = WKSnapshotConfiguration()
cfg.rect = NSRect(x: 0, y: 0, width: w, height: h)
var finished = false
view.takeSnapshot(with: cfg) { image, error in
  defer { finished = true }
  guard let image, let tiff = image.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff),
        let png = rep.representation(using: .png, properties: [:]) else {
    fputs("snapshot failed: \(error?.localizedDescription ?? "unknown")\n", stderr); return
  }
  try? png.write(to: out)
}
let snapDeadline = Date().addingTimeInterval(15)
while !finished && Date() < snapDeadline { RunLoop.current.run(mode: .default, before: Date().addingTimeInterval(0.05)) }
