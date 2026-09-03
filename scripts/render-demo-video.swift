#!/usr/bin/env swift

import AVFoundation
import CoreImage
import CoreVideo
import Foundation

guard CommandLine.arguments.count == 4 else {
  fputs("Usage: render-demo-video.swift <frames-directory> <output.mp4> <fps>\n", stderr)
  exit(64)
}

let framesDirectory = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
let outputURL = URL(fileURLWithPath: CommandLine.arguments[2])
guard let framesPerSecond = Int32(CommandLine.arguments[3]), framesPerSecond > 0 else {
  fputs("Frames per second must be a positive integer.\n", stderr)
  exit(64)
}

let fileManager = FileManager.default
let frameURLs = try fileManager.contentsOfDirectory(
  at: framesDirectory,
  includingPropertiesForKeys: nil,
  options: [.skipsHiddenFiles]
).filter { $0.pathExtension.lowercased() == "png" }
 .sorted { $0.lastPathComponent < $1.lastPathComponent }

guard let firstURL = frameURLs.first, let firstImage = CIImage(contentsOf: firstURL) else {
  fputs("No readable PNG frames were found.\n", stderr)
  exit(66)
}

let width = Int(firstImage.extent.width)
let height = Int(firstImage.extent.height)
if fileManager.fileExists(atPath: outputURL.path) {
  try fileManager.removeItem(at: outputURL)
}

let writer = try AVAssetWriter(outputURL: outputURL, fileType: .mp4)
let videoSettings: [String: Any] = [
  AVVideoCodecKey: AVVideoCodecType.h264,
  AVVideoWidthKey: width,
  AVVideoHeightKey: height,
  AVVideoCompressionPropertiesKey: [
    AVVideoAverageBitRateKey: 6_000_000,
    AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel
  ]
]
let input = AVAssetWriterInput(mediaType: .video, outputSettings: videoSettings)
input.expectsMediaDataInRealTime = false

let pixelBufferAttributes: [String: Any] = [
  kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
  kCVPixelBufferWidthKey as String: width,
  kCVPixelBufferHeightKey as String: height,
  kCVPixelBufferCGImageCompatibilityKey as String: true,
  kCVPixelBufferCGBitmapContextCompatibilityKey as String: true
]
let adaptor = AVAssetWriterInputPixelBufferAdaptor(
  assetWriterInput: input,
  sourcePixelBufferAttributes: pixelBufferAttributes
)

guard writer.canAdd(input) else {
  fputs("The video writer could not accept the H.264 input.\n", stderr)
  exit(70)
}
writer.add(input)

guard writer.startWriting() else {
  throw writer.error ?? NSError(domain: "PhotoGitDemoVideo", code: 1)
}
writer.startSession(atSourceTime: .zero)

let context = CIContext(options: [.cacheIntermediates: false])
for (index, frameURL) in frameURLs.enumerated() {
  while !input.isReadyForMoreMediaData {
    Thread.sleep(forTimeInterval: 0.002)
  }
  guard let image = CIImage(contentsOf: frameURL) else {
    fputs("Could not decode \(frameURL.lastPathComponent).\n", stderr)
    exit(65)
  }
  var pixelBuffer: CVPixelBuffer?
  guard
    let pool = adaptor.pixelBufferPool,
    CVPixelBufferPoolCreatePixelBuffer(nil, pool, &pixelBuffer) == kCVReturnSuccess,
    let pixelBuffer
  else {
    fputs("Could not allocate a video frame buffer.\n", stderr)
    exit(70)
  }
  context.render(
    image,
    to: pixelBuffer,
    bounds: CGRect(x: 0, y: 0, width: width, height: height),
    colorSpace: CGColorSpace(name: CGColorSpace.sRGB)
  )
  let presentationTime = CMTime(value: Int64(index), timescale: framesPerSecond)
  guard adaptor.append(pixelBuffer, withPresentationTime: presentationTime) else {
    throw writer.error ?? NSError(domain: "PhotoGitDemoVideo", code: 2)
  }
}

input.markAsFinished()
let semaphore = DispatchSemaphore(value: 0)
writer.finishWriting { semaphore.signal() }
semaphore.wait()

guard writer.status == .completed else {
  throw writer.error ?? NSError(domain: "PhotoGitDemoVideo", code: 3)
}

print("Created \(outputURL.path) from \(frameURLs.count) frames at \(framesPerSecond) fps (\(width)x\(height)).")
