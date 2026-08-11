# Forty Pirates for Claude Code

Your travel workspace, in conversation. Ask what you've saved, build a list or a map
of places just by naming them, and tidy up what's already there — in plain English.

## Get it

Paste these two lines into Claude Code:

```
/plugin marketplace add contextforce/fortypirates-skill
/plugin install fortypirates-workspace@fortypirates
```

## First time

Just ask it something. You'll get a link — open it, click **Allow**, done. Nothing to
copy, nothing to set up, and you won't be asked again.

You'll need a free account at [fortypirates.com](https://fortypirates.com).

## Try asking

> What have I saved in Tokyo?

> Make me a list of matcha cafés in Kyoto

> Make a map of the best ramen in Shibuya

> Add the Ghibli Museum to my Tokyo list

> What's in my Japan list?

It finds the real places, saves them with photos, and gives you a link to open.

## Using it somewhere other than Claude Code

Claude Desktop, ChatGPT and other assistants connect through **MCP** instead of the
plugin above. Same workspace, same abilities.

1. Get a key at [fortypirates.com/settings/cli](https://fortypirates.com/settings/cli)
   → **Create key**, and copy it.
2. In your app, add a custom MCP connector:

   | | |
   |---|---|
   | **URL** | `https://fortypirates.com/api/mcp` |
   | **Header** | `Authorization: Bearer` *your key* |

Claude Desktop can also be configured by hand — add this to its config file
(*Settings → Developer → Edit Config*):

```json
{
  "mcpServers": {
    "fortypirates": {
      "url": "https://fortypirates.com/api/mcp",
      "headers": { "Authorization": "Bearer PASTE_YOUR_KEY_HERE" }
    }
  }
}
```

Restart the app and ask it the same questions as above.

> Some assistants only accept connectors that sign you in with a browser rather than
> a key. Those can't connect yet — support is on the way.

## Your stuff stays yours

Lists are private unless you share them. To disconnect Claude Code from your account,
visit [fortypirates.com/settings/cli](https://fortypirates.com/settings/cli) and click
disconnect — it stops working immediately.
