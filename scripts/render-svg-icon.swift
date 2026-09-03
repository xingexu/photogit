#!/usr/bin/env swift

import AppKit
import Foundation

guard CommandLine.arguments.count == 4, let size = Int(CommandLine.arguments[3]), size > 0 else {
  fputs("Usage: render-svg-icon.swift <input.svg> <output.png> <pixel-size>\n", stderr)
  exit(64)
}

let inputURL = URL(fileURLWithPath: CommandLine.arguments[1])
let outputURL = URL(fileURLWithPath: CommandLine.arguments[2])
guard let source = NSImage(contentsOf: inputURL) else {
  fputs("Could not read the SVG source.\n", stderr)
  exit(66)
}

guard let bitmap = NSBitmapImageRep(
  bitmapDataPlanes: nil,
  pixelsWide: size,
  pixelsHigh: size,
  bitsPerSample: 8,
  samplesPerPixel: 4,
  hasAlpha: true,
  isPlanar: false,
  colorSpaceName: .deviceRGB,
  bytesPerRow: 0,
  bitsPerPixel: 0
) else {
  fputs("Could not allocate the icon bitmap.\n", stderr)
  exit(70)
}

bitmap.size = NSSize(width: size, height: size)
NSGraphicsContext.saveGraphicsState()
guard let context = NSGraphicsContext(bitmapImageRep: bitmap) else {
  fputs("Could not create the icon drawing context.\n", stderr)
  exit(70)
}
NSGraphicsContext.current = context
context.imageInterpolation = .high
NSColor.clear.setFill()
NSRect(x: 0, y: 0, width: size, height: size).fill()
source.draw(
  in: NSRect(x: 0, y: 0, width: size, height: size),
  from: NSRect(origin: .zero, size: source.size),
  operation: .sourceOver,
  fraction: 1
)
context.flushGraphics()
NSGraphicsContext.restoreGraphicsState()

guard let png = bitmap.representation(using: .png, properties: [:]) else {
  fputs("Could not encode the PNG icon.\n", stderr)
  exit(70)
}
try png.write(to: outputURL, options: .atomic)
print("Created \(outputURL.path) at \(size)x\(size).")
