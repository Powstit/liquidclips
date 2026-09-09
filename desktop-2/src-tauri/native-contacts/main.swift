// Liquid Clips — native macOS Contacts picker helper (Phase 2).
//
// Spawned as a short-lived subprocess by the Tauri Rust shell (see
// src-tauri/src/contacts_picker.rs). Not a standalone app the user
// launches directly — no Dock icon, no menu bar.
//
// Shows exactly one native CNContactPicker popover, lets the user
// explicitly select ONE contact (or cancel), prints a single line of
// JSON to stdout describing the result, then exits.
//
// Deliberately does NOT:
//   - use CNContactStore to enumerate the address book (no bulk read)
//   - auto-select anything
//   - offer a "select all" affordance (CNContactPicker has none)
//   - make any network request
//   - implement the no-email manual-entry fallback (that lives in the
//     React frontend — this helper only reports "no_email" and exits)

import Cocoa
import Contacts
import ContactsUI

func jsonEscaped(_ s: String) -> String {
    var out = ""
    for ch in s.unicodeScalars {
        switch ch {
        case "\"": out += "\\\""
        case "\\": out += "\\\\"
        case "\n": out += "\\n"
        case "\r": out += "\\r"
        case "\t": out += "\\t"
        default:
            if ch.value < 0x20 {
                out += String(format: "\\u%04x", ch.value)
            } else {
                out.unicodeScalars.append(ch)
            }
        }
    }
    return out
}

func printResultAndExit(_ json: String) -> Never {
    print(json)
    exit(0)
}

final class PickerRunner: NSObject, CNContactPickerDelegate {
    private var picker: CNContactPicker?
    private var anchorWindow: NSWindow?
    private var resolved = false

    func run() {
        // CNContactPicker is a popover; it needs a positioning view
        // attached to an on-screen window. This 1x1 borderless window
        // is not user-facing UI — it exists only to host that anchor.
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1, height: 1),
            styleMask: [.borderless],
            backing: .buffered,
            defer: false
        )
        window.isReleasedWhenClosed = false
        window.setFrameOrigin(NSPoint(x: 0, y: 0))
        window.orderFrontRegardless()
        anchorWindow = window

        let anchorView = NSView(frame: NSRect(x: 0, y: 0, width: 1, height: 1))
        window.contentView = anchorView

        let picker = CNContactPicker()
        picker.delegate = self
        self.picker = picker
        NSApp.activate(ignoringOtherApps: true)
        picker.showRelative(to: anchorView.bounds, of: anchorView, preferredEdge: .maxY)
    }

    // Native Messages handoff (Phase 3) — relays every phone number on
    // the selected contact, labeled, so the frontend can offer a
    // "Send via Messages" (sms:) alternative alongside email. This is
    // pure data extraction: no Messages access, no iMessage-capability
    // check (Apple exposes no such API), no Apple Events.
    func phoneNumbersJson(_ contact: CNContact) -> String {
        let entries = contact.phoneNumbers.map { labeled -> String in
            let label = labeled.label.map { CNLabeledValue<CNPhoneNumber>.localizedString(forLabel: $0) } ?? ""
            let number = labeled.value.stringValue
            return "{\"number\":\"\(jsonEscaped(number))\",\"label\":\"\(jsonEscaped(label))\"}"
        }
        return "[" + entries.joined(separator: ",") + "]"
    }

    // Only called when displayedKeys is empty (it is, by default here) —
    // hands back a whole explicitly-selected CNContact, not a bulk list.
    func contactPicker(_ picker: CNContactPicker, didSelect contact: CNContact) {
        guard !resolved else { return }
        resolved = true

        let displayName = CNContactFormatter.string(from: contact, style: .fullName)
            ?? "\(contact.givenName) \(contact.familyName)".trimmingCharacters(in: .whitespaces)
        let phones = phoneNumbersJson(contact)

        if let email = contact.emailAddresses.first {
            // Multiple-email contacts: first address wins, matching the
            // POC's validated behavior. No other emails are read/sent.
            let json = "{\"status\":\"selected\",\"email\":\"\(jsonEscaped(String(email.value)))\",\"displayName\":\"\(jsonEscaped(displayName))\",\"phoneNumbers\":\(phones)}"
            printResultAndExit(json)
        } else {
            let json = "{\"status\":\"no_email\",\"displayName\":\"\(jsonEscaped(displayName))\",\"phoneNumbers\":\(phones)}"
            printResultAndExit(json)
        }
    }

    func contactPickerDidClose(_ picker: CNContactPicker) {
        guard !resolved else { return }
        resolved = true
        printResultAndExit("{\"status\":\"cancelled\"}")
    }
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let runner = PickerRunner()
DispatchQueue.main.async {
    runner.run()
}
app.run()
