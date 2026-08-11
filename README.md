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

The first time you ask about your workspace, you get a link. Open it, click
**Allow**, and you're connected — nothing to copy, nothing to paste. The key is
saved to `~/.config/fortypirates/token` and every later session uses it.

No account yet? Sign up at [fortypirates.com](https://fortypirates.com) first.

## What you can ask

- *"What have I saved in Tokyo?"*
- *"Make me a list of matcha cafés in Kyoto"*
- *"Make a map of the best ramen in Shibuya"*
- *"Add the Ghibli Museum to my Tokyo list"*
- *"What's in my Japan list?"*

Lists you create are private to your account. Disconnect any time at
[fortypirates.com/settings/cli](https://fortypirates.com/settings/cli).

## No install, no dependencies

Every command is a `curl` — including signing in. Nothing to install, no runtime,
nothing to keep updated.
