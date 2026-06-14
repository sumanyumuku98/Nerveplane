# Contributing to Nerveplane

Thanks for your interest! PRs are welcome — keep them focused, with `bun test && bun run typecheck` green. See the [roadmap](https://sumanyumuku98.github.io/Nerveplane/roadmap) for where to start.

## License of contributions

Nerveplane's core is licensed under **[FSL-1.1-MIT](LICENSE)** (source-available; converts to MIT two years after each release).

## Developer Certificate of Origin (DCO)

By contributing, you certify the [Developer Certificate of Origin](https://developercertificate.org/) — i.e. that you wrote the change (or have the right to submit it) and agree it's contributed under the project's license.

Sign off each commit with `-s`:

```bash
git commit -s -m "your message"
```

This adds a `Signed-off-by: Your Name <you@example.com>` trailer. That's all we need — no separate CLA.

## Dev setup

```bash
bun install && bun run build:dashboard
bun test
bun run typecheck
```
