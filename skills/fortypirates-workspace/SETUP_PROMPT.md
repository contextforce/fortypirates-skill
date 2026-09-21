# Set up Forty Pirates

Set up Forty Pirates completely for this machine. Forty Pirates is the user's travel
workspace — the places, lists and maps they have saved, and the friends whose
recommendations they trust. Do the work yourself where you can. Pause only when the user
must create an account, sign in, approve access, or restart the client.

## Pick the route that matches this client

**Claude Code** — install the plugin. It brings the skill with it:

```
/plugin marketplace add contextforce/fortypirates-skill
/plugin install fortypirates-workspace@fortypirates
```

If the user would rather have only the tools, add the MCP server instead:

```
claude mcp add --transport http fortypirates https://fortypirates.com/api/mcp
```

**Claude Desktop, claude.ai, or any other client with MCP connectors** — this part is
the user's to do, because it is a settings screen you cannot reach. Tell them exactly
this, and wait:

1. Settings → Connectors → Add → Add custom connector
2. Name: `fortypirates`
3. URL: `https://fortypirates.com/api/mcp`
4. Leave the OAuth fields under *Advanced settings* empty — they are optional
5. Add, then sign in and click **Allow**

**Anything else that speaks MCP** — point it at `https://fortypirates.com/api/mcp`
using that client's own configuration. Do not invent a config format, and do not use a
different endpoint.

## Get it authorised

1. The first call opens the browser. Ask the user to sign in and click **Allow** — once.
   If they have no account yet, send them to https://fortypirates.com to create a free
   one and wait for them to finish.
2. **Never ask the user to paste a token into the conversation**, and never print, log
   or save one. The approval flow hands the key to the client directly; a key that
   passes through a chat transcript is a key that has leaked.
3. If the client must restart before it will load a new server, say exactly what needs
   restarting, and carry on with this setup afterwards.

## Verify it, and do not skip this

1. Call the `whoami` tool. It returns the account, its workspace url, and how many lists
   and friends are behind it.
2. **Do not tell the user they are connected until `whoami` returns the account they
   expect.** A 200 proves a server answered; it does not prove the right account did.
   If the username is not theirs, stop — they are signed into the wrong account.
3. Call `my_lists`. This proves reads work against real data rather than an empty
   handshake.
4. **Do not create a list to prove the setup works.** Writes land in the user's real
   workspace and show up in their app. If you want to prove writing, ask first, and let
   the user say what the list should be — their first list should be one they wanted.

## Tell them what they can now ask

Give a short checklist of what succeeded, with the workspace link from `whoami`, then
three examples drawn from what they actually have:

> What have I saved in Tokyo?
> Make me a list of matcha cafés in Kyoto.
> Where have my friends been in Lisbon?

If the user has no saved places yet, say so plainly and suggest the one that works from
empty — building a list from names.

## When something fails

Stop and name the exact step that failed. Do not skip a failed check, and do not call
the setup complete without both an authorised connection and a `whoami` that returns the
intended account.

- **401** — the key was revoked or expired. Reconnect; do not retry the same call.
- **404 on a list** — the id is stale. Re-read `my_lists` (trips need `includeTrips`).
- **The wrong account** — the user is signed into a different Forty Pirates account in
  that browser. They can disconnect at https://fortypirates.com/settings/cli and
  approve again as the right one.
