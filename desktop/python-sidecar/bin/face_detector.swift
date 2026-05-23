// junior-face-detect — Apple Vision-accelerated face X detection.
//
// Replaces OpenCV's Haar cascade for the median face-X measurement that the
// reframe stage uses to centre 16:9 → 9:16 crops on the speaker. About 5×
// faster than the Python+OpenCV path on M-series Macs because Vision runs
// on the AMX / Neural Engine via Metal.
//
// Usage:
//   junior-face-detect <video.mp4> <samples> <out.json>
//
// Output JSON shape (read by python-sidecar/stages.py):
//   {
//     "ok": true,
//     "median_face_cx": 952.5,    // pixel x of the centroid (0 if no faces)
//     "video_width": 1920,
//     "video_height": 1080,
//     "faces_per_sample": [1,1,2,1,1,1,1,0,1,1],
//     "sample_count_used": 9
//   }
//
// On any failure we emit {"ok": false, "error": "..."} so Python can fall
// back to the OpenCV path without raising.

import Foundation
import AVFoundation
import Vision
import CoreImage

@MainActor
func detectFaceXMedian(video: URL, samples: Int) async throws -> [String: Any] {
    let asset = AVURLAsset(url: video)
    let durationSec = try await asset.load(.duration).seconds
    let tracks = try await asset.loadTracks(withMediaType: .video)
    guard let track = tracks.first else {
        return ["ok": false, "error": "no video track"]
    }
    let size = try await track.load(.naturalSize)
    let transform = try await track.load(.preferredTransform)
    let displaySize = size.applying(transform)
    let absWidth = abs(displaySize.width)
    let absHeight = abs(displaySize.height)

    // Sample N evenly across the middle 90% of the clip — match the OpenCV path.
    let n = max(1, samples)
    let margin = durationSec * 0.05
    let usable = max(0.1, durationSec - 2 * margin)
    var timeStamps: [CMTime] = []
    if n == 1 {
        timeStamps.append(CMTime(seconds: durationSec / 2, preferredTimescale: 600))
    } else {
        for i in 0..<n {
            let t = margin + (Double(i) / Double(n - 1)) * usable
            timeStamps.append(CMTime(seconds: t, preferredTimescale: 600))
        }
    }

    let generator = AVAssetImageGenerator(asset: asset)
    generator.appliesPreferredTrackTransform = true
    generator.requestedTimeToleranceBefore = .zero
    generator.requestedTimeToleranceAfter = CMTime(seconds: 0.25, preferredTimescale: 600)

    var faceXs: [Double] = []
    var facesPerSample: [Int] = []
    var samplesUsed = 0

    for ts in timeStamps {
        do {
            let cgImage = try await generator.image(at: ts).image
            let request = VNDetectFaceRectanglesRequest()
            request.revision = VNDetectFaceRectanglesRequestRevision3
            let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
            try handler.perform([request])
            let observations = request.results ?? []
            facesPerSample.append(observations.count)
            samplesUsed += 1
            // Convert Vision's normalised, bottom-left-origin bounding boxes to
            // pixel-X centroids on the original frame. Vision returns x ∈ [0,1]
            // where 0 = left, 1 = right — matches what OpenCV reports.
            for obs in observations {
                let bbox = obs.boundingBox
                let cxNorm = bbox.midX
                faceXs.append(cxNorm * Double(absWidth))
            }
        } catch {
            facesPerSample.append(0)
        }
    }

    let median: Double
    if faceXs.isEmpty {
        median = 0
    } else {
        let sorted = faceXs.sorted()
        let mid = sorted.count / 2
        median = sorted.count % 2 == 0
            ? (sorted[mid - 1] + sorted[mid]) / 2
            : sorted[mid]
    }

    return [
        "ok": true,
        "median_face_cx": median,
        "video_width": Int(absWidth),
        "video_height": Int(absHeight),
        "faces_per_sample": facesPerSample,
        "sample_count_used": samplesUsed,
    ]
}

@main
struct JuniorFaceDetect {
    static func main() async {
        let args = CommandLine.arguments
        guard args.count == 4 else {
            FileHandle.standardError.write(Data("usage: junior-face-detect <video> <samples> <out.json>\n".utf8))
            exit(64)
        }
        let videoPath = args[1]
        let samples = Int(args[2]) ?? 10
        let outPath = args[3]

        let url = URL(fileURLWithPath: videoPath)
        do {
            let result = try await detectFaceXMedian(video: url, samples: samples)
            let data = try JSONSerialization.data(withJSONObject: result, options: [.prettyPrinted])
            try data.write(to: URL(fileURLWithPath: outPath))
            exit(0)
        } catch {
            let err: [String: Any] = ["ok": false, "error": "\(error)"]
            if let data = try? JSONSerialization.data(withJSONObject: err) {
                try? data.write(to: URL(fileURLWithPath: outPath))
            }
            exit(1)
        }
    }
}
