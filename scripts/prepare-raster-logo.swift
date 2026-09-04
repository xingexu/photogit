#!/usr/bin/env swift

import AppKit
import Foundation

guard CommandLine.arguments.count == 4, let size = Int(CommandLine.arguments[3]), size > 0 else {
  fputs("Usage: prepare-raster-logo.swift <input-image> <output.png> <pixel-size>\n", stderr)
  exit(64)
}

let inputURL = URL(fileURLWithPath: CommandLine.arguments[1])
let outputURL = URL(fileURLWithPath: CommandLine.arguments[2])
guard
  let source = NSImage(contentsOf: inputURL),
  let tiff = source.tiffRepresentation,
  let sourceBitmap = NSBitmapImageRep(data: tiff)
else {
  fputs("Could not read the source image.\n", stderr)
  exit(66)
}

// Work in pixels even when macOS imports a Retina screenshot with a 2× point size.
source.size = NSSize(width: sourceBitmap.pixelsWide, height: sourceBitmap.pixelsHigh)

// Find the dark app tile rather than depending on screenshot-specific coordinates.
var minX = sourceBitmap.pixelsWide
var minY = sourceBitmap.pixelsHigh
var maxX = -1
var maxY = -1
for y in 0..<sourceBitmap.pixelsHigh {
  for x in 0..<sourceBitmap.pixelsWide {
    guard let color = sourceBitmap.colorAt(x: x, y: y)?.usingColorSpace(.deviceRGB) else { continue }
    if color.alphaComponent > 0.5,
       max(color.redComponent, color.greenComponent, color.blueComponent) < 0.12 {
      minX = min(minX, x)
      minY = min(minY, y)
      maxX = max(maxX, x)
      maxY = max(maxY, y)
    }
  }
}

guard maxX >= minX, maxY >= minY else {
  fputs("Could not locate the dark logo tile.\n", stderr)
  exit(65)
}

let tileWidth = CGFloat(maxX - minX + 1)
let tileHeight = CGFloat(maxY - minY + 1)
// Crop a hair inside the detected edge so a light screenshot halo cannot leak
// into the antialiased perimeter of the final transparent tile.
let cropSide = max(tileWidth, tileHeight) * 0.975
let cropCenter = NSPoint(x: CGFloat(minX + maxX) / 2, y: CGFloat(minY + maxY) / 2)
let cropRect = NSRect(
  x: cropCenter.x - cropSide / 2,
  y: cropCenter.y - cropSide / 2,
  width: cropSide,
  height: cropSide
)

guard let outputBitmap = NSBitmapImageRep(
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
  fputs("Could not allocate the output bitmap.\n", stderr)
  exit(70)
}

outputBitmap.size = NSSize(width: size, height: size)
guard let context = NSGraphicsContext(bitmapImageRep: outputBitmap) else {
  fputs("Could not create the output context.\n", stderr)
  exit(70)
}

NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = context
context.imageInterpolation = .high
NSColor.clear.setFill()
NSRect(x: 0, y: 0, width: size, height: size).fill()

let inset = CGFloat(size) * 0.012
let tileRect = NSRect(x: inset, y: inset, width: CGFloat(size) - inset * 2, height: CGFloat(size) - inset * 2)
let tilePath = NSBezierPath(roundedRect: tileRect, xRadius: CGFloat(size) * 0.19, yRadius: CGFloat(size) * 0.19)
tilePath.addClip()
source.draw(in: tileRect, from: cropRect, operation: .sourceOver, fraction: 1)
context.flushGraphics()
NSGraphicsContext.restoreGraphicsState()

guard let png = outputBitmap.representation(using: .png, properties: [:]) else {
  fputs("Could not encode the PNG logo.\n", stderr)
  exit(70)
}

try png.write(to: outputURL, options: .atomic)
print("Created \(outputURL.path) at \(size)x\(size).")
