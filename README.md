# Forty Pirates for Claude Code

Your [Forty Pirates](https://fortypirates.com) travel workspace, from your terminal.
Ask for what you saved, build a list or a map from place names, and organise what's
already there — in plain language.

## Install

```
/plugin marketplace add contextforce/fortypirates-skill
/plugin install fortypirates-workspace@fortypirates
```

## Connect (once)

The first time you ask about your workspace, your browser opens and you click
**Allow**. That's it — a key is saved to `~/.config/fortypirates/token` and every
later session uses it.

No account yet? Sign up at [fortypirates.com](https://fortypirates.com) first.

## What you can ask

- *"What have I saved in Tokyo?"*
- *"Make me a list of matcha cafés in Kyoto"*
- *"Make a map of the best ramen in Shibuya"*
- *"Add the Ghibli Museum to my Tokyo list"*
- *"What's in my Japan list?"*

Lists you create are private to your account. Disconnect any time at
[fortypirates.com/settings/cli](https://fortypirates.com/settings/cli).

## Requirements

Node 18+ (for the one-time browser sign-in). Everything else is plain HTTPS.
