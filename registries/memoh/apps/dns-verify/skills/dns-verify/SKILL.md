---
name: dns-verify
description: Report the DNS posture of a macOS or Linux workstation, including whether it uses its own resolver, routes all lookups through the tunnel, and is free of hijacking and leakage. Use when the user asks about DNS leaks, DNS hijacking, resolvers, VPN or proxy DNS behavior, or how to harden a workstation's DNS.
metadata:
  author:
    name: fdaio
  tags:
    - dns
    - security
    - privacy
    - network
  category: security
  homepage: https://github.com/fdaio/dns-verify
---

# DNS Verify

Score a workstation's DNS posture in one run and turn the findings into the
next concrete fix. The App installs the `dns-verify` binary; call it directly.

macOS and Linux only. The check only reads: it never changes a resolver, a
route, or any setting.

## Run

```bash
dns-verify            # score out of ten, four verdicts, the next fix
dns-verify -v         # add the measurements behind each verdict
dns-verify --fail-under 8   # exit 1 when the score is below 8 (pipeline gate)
```

A plain run always exits 0. `--fail-under N` is the only thing that can make it
exit non-zero, so do not treat exit 0 alone as "passed" when scoring a pipeline.

## Read the report

Four questions, 2.5 points each:

| Label | Question |
|-------|----------|
| `Own DNS` | Does the system use a resolver of its own? |
| `All DNS via proxy` | Does every lookup go through the tunnel/proxy? |
| `DNS hijacking` | Is any answer rewritten by a network in between? |
| `DNS leakage` | Do queries or their source addresses escape the tunnel? |

Verdict states: `good` (2.5, control holds), `warn` (1.5, partial coverage),
`unmanaged` (0, nothing controls it), `unknown` (0, measurement did not
complete). When none of the four is controlled the grade reads `NOT MANAGED`.

The headline also counts how many questions were left unmeasured. An unmeasured
question is never reported as clean, so treat `unknown` as "not yet shown safe",
not as a pass.

## Act on the findings

The `FIX FIRST` section lists the highest-value changes, in order. A fix carries
a runnable command only when the tool can name both the service and the address
to write, and only when that command is the one the system actually uses.

- `1. Point every network service at the resolver your tunnel provides` — set
  the resolver per system service, or explicitly, before trusting the tunnel.
- `2. Block outbound port 53 so only the tunnel resolver stays reachable` —
  prevents cleartext fallback and leaks.

Report the exact findings and the suggested commands to the user; let them apply
changes to their own system. Do not invent a fix when the tool did not name one.

## Notes

- Reading resolver configuration differs per system: SystemConfiguration on
  macOS, `/etc/resolv.conf` plus the stack behind it on Linux. Run the check on
  the target machine; a binary built for a system it cannot read refuses to run.
- For a full explanation of each measurement, see the project README at
  https://github.com/fdaio/dns-verify.
