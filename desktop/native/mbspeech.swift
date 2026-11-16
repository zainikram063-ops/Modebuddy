// ModeBuddy speech helper: Apple speech-to-text, on the Mac itself when it can.
// Reads "start" / "stop" / "hints [...]" lines, writes JSON lines with your words.
import AVFoundation
import Foundation
import Speech

func out(_ o: [String: Any]) {
  guard let d = try? JSONSerialization.data(withJSONObject: o), let s = String(data: d, encoding: .utf8) else { return }
  print(s)
  fflush(stdout)
}

let recognizer = SFSpeechRecognizer(locale: Locale(identifier: ProcessInfo.processInfo.environment["MB_LANG"] ?? "en-US"))
let engine = AVAudioEngine()
var request: SFSpeechAudioBufferRecognitionRequest?
var task: SFSpeechRecognitionTask?
var hints: [String] = []
var allowed = false
var session = 0

SFSpeechRecognizer.requestAuthorization { status in
  DispatchQueue.main.async {
    allowed = status == .authorized
    out(["ready": allowed, "ondevice": recognizer?.supportsOnDeviceRecognition ?? false])
  }
}

func halt(keep: Bool) {
  if engine.isRunning { engine.stop() }
  engine.inputNode.removeTap(onBus: 0)
  if keep { request?.endAudio() } else { task?.cancel(); task = nil; request = nil }
}

func start() {
  halt(keep: false)
  guard allowed, let rec = recognizer, rec.isAvailable else { out(["final": ""]); return }
  session += 1
  let id = session
  let req = SFSpeechAudioBufferRecognitionRequest()
  req.shouldReportPartialResults = true
  req.contextualStrings = hints
  if rec.supportsOnDeviceRecognition { req.requiresOnDeviceRecognition = true }
  request = req
  let input = engine.inputNode
  let fmt = input.outputFormat(forBus: 0)
  guard fmt.sampleRate > 0 else { out(["final": ""]); return }
  input.installTap(onBus: 0, bufferSize: 1024, format: fmt) { buf, _ in req.append(buf) }
  engine.prepare()
  do { try engine.start() } catch { out(["final": ""]); return }
  var last = "", sent = false
  task = rec.recognitionTask(with: req) { result, error in
    DispatchQueue.main.async {
      guard id == session, !sent else { return }
      if let r = result {
        last = r.bestTranscription.formattedString
        if r.isFinal { sent = true; out(["final": last]) } else { out(["partial": last]) }
      }
      if error != nil && !sent { sent = true; out(["final": last]) }
    }
  }
  // Never keep the mic on by mistake
  DispatchQueue.main.asyncAfter(deadline: .now() + 30) { if id == session { halt(keep: true) } }
}

DispatchQueue.global().async {
  while let line = readLine() {
    DispatchQueue.main.async {
      if line == "start" { start() }
      else if line == "stop" { halt(keep: true) }
      else if line.hasPrefix("hints "), let d = line.dropFirst(6).data(using: .utf8), let a = try? JSONSerialization.jsonObject(with: d) as? [Any] { hints = a.compactMap { $0 as? String } }
    }
  }
  exit(0)
}
RunLoop.main.run()
