---
name: fortypirates-workspace
description: |
  Read and change the user's Forty Pirates workspace — their saved places, dishes, and
  experiences, and the lists those live in. Search what they've saved, list their
  collections, see what's in one, create a list, and move ingredients in and out of it.
  Use when the user asks about "my saved places", "my lists", "my workspace", "what did I
  save in Tokyo", "put that in my Japan list", or asks to organise, find, or add to their
  own saved travel content. Plain HTTPS against fortypirates.com — no install.
---

# Forty Pirates workspace

The user's workspace is a personal travel knowledge graph: **ingredients** (a place,
a dish, an experience) saved from videos and articles, and **lists** that group them.
This skill reads and edits it over HTTP.

```
  you  ──curl──>  https://fortypirates.com/api/…  ──>  the user's own workspace
                  Authorization: Bearer fp_pat_…
```

## Connecting (once per machine)

Check first — most of the time this is already done:

```bash
node "$SKILL_DIR/scripts/connect.mjs" --status
```

If it reports `connected: false`, run the connect flow. It opens the user's browser,
they click **Allow**, and the key is written to `~/.config/fortypirates/token`:

```bash
node "$SKILL_DIR/scripts/connect.mjs"
```

Tell the user what's about to happen ("I'll open your browser so you can approve
access") and let it run — it prints the URL too, in case the browser doesn't open.
On a machine with no browser at all, use `--show-url` and give them the link, or send
them to **https://fortypirates.com/settings/cli** to create a key and paste it as
`$FP_TOKEN`.

Every command after that reads the saved key:

```bash
FP="${FP_TOKEN:-$(cat ~/.config/fortypirates/token 2>/dev/null)}"
```

**Never print the key**, never echo it into a reply, never copy it anywhere but that
file. A `401` means it was revoked or expired — re-run `connect.mjs`, don't retry the
call.

## Identity

Every call resolves the user from the token — token → email → username → their own
storage prefix. There is no owner parameter on any endpoint, so one user can never read
another's workspace by changing a value. Get the username when you need it for a path:

```bash
curl -s -H "authorization: Bearer $FP" https://fortypirates.com/api/pirates/me | jq -r .username
```

## Reading the workspace

**Everything they've saved** — one row per ingredient, already slim (id, kind, title,
image, coordinates). Prefer this over the full snapshot; it is ~10× smaller and cached
server-side.

```bash
curl -s -H "authorization: Bearer $FP" \
  'https://fortypirates.com/api/profile/global-storefront/snapshot?picker=1' \
| jq '.items'
```

**Search** is a filter over that list — there is no search endpoint. Match on `title`,
narrow by `kind`:

```bash
curl -s -H "authorization: Bearer $FP" \
  'https://fortypirates.com/api/profile/global-storefront/snapshot?picker=1' \
| jq --arg q tokyo '[.items[] | select(.kind=="poi") | select(.title|ascii_downcase|contains($q))][:20]'
```

`kind` is one of `poi` (a place), `item` (a dish or product tied to a place), `me`
(a micro-experience — a walk, an afternoon), `tip`, `food`, `activity`, `product`,
`event`, `collection`, `source`.

**The full snapshot** — only when you need fields the slim projection drops (tags,
source attribution, mentions). It is 150–700 KB; never fetch it to answer "what did I
save", and never paste it into a reply.

```bash
curl -s -H "authorization: Bearer $FP" \
  https://fortypirates.com/api/profile/global-storefront/snapshot | jq '.stubs | length'
```

## A list from place NAMES

The user asks for "a list of matcha cafes in Kyoto", "Tokyo restaurants", or "places to
re-experience the anime Your Name". They are NOT asking you to search their workspace —
they want a list of real places that may not be saved yet.

**Come up with the names yourself.** Use what you know; web-search when the subject is
specific enough that guessing would be wrong (an anime's real filming locations, a
chef's restaurants, a neighbourhood you don't know well). Then submit the names — the
endpoint grounds each one to a real place with coordinates and a photo. One call grounds each name to a real place,
saves it, builds the list, and hands back the URL:

```bash
curl -s -X POST -H "authorization: Bearer $FP" -H 'content-type: application/json' \
  -d '{"name":"Kyoto matcha cafes","near":"Kyoto",
       "places":["Ippodo Tea Kyoto Main Store","Tsujiri Gion Honten","Kagizen Yoshifusa"]}' \
  https://fortypirates.com/api/lists/from-names
```

```json
{ "url": "/@{username}/kyoto-matcha-cafes",
  "saved": [{"query":"…","title":"…","placeId":"ChIJ…","address":"…"}],
  "notFound": [] }
```

- **`near` matters.** "Blue Bottle" is a hundred cafés; "Blue Bottle" near Kyoto is one.
  Pass the city as a string, or `{"lat":…,"lng":…}`.
- **Name the branch when you mean one** — "Kurasu Kyoto Stand", not "Kurasu". The lookup
  resolves what you asked for, so a vague name gets a vague answer.
- **Don't ask permission first.** Making a list is cheap and reversible; propose the
  names only if the request is ambiguous about the place or the theme.
- **Report what resolved**, and mention anything in `notFound` — those simply weren't
  saved. A name that resolves to a different branch than intended is worth flagging too.
- **Cover image** defaults to the first place's photo. To choose your own, pass
  `coverImage` — **any image url works**; it is fetched and cached to R2, and the list
  stores the resulting key, so the cover never depends on someone else's host. A bare
  `media/…` key is accepted as-is, and `""` clears it. If the url can't be cached the
  response says so in `coverNote` and falls back to the first place — check for it
  rather than assuming your image was used. An append never repaints an existing
  list's cover unless you ask.
- Max 50 places per call. Grounding is sequential, so a long list takes a while.
- The list is PRIVATE by default; the URL works for its owner.

**Adding to an EXISTING list** is the same call with `listId` instead of `name` —
"add the Ghibli Museum to my Tokyo list". Names ground the same way; membership unions,
so re-adding something already there is harmless:

```bash
curl -s -X POST -H "authorization: Bearer $FP" -H 'content-type: application/json' \
  -d '{"listId":"<id from /api/drawer/lists>","near":"Tokyo","places":["Ghibli Museum"]}' \
  https://fortypirates.com/api/lists/from-names
```

**Removing by name** needs NO place lookup. The list already carries every member's id
next to its name — read it, pick the matching one, send that id:

```bash
# 1. the list's own contents: {id, name} per ingredient
curl -s -H "authorization: Bearer $FP" "https://fortypirates.com/api/lists/$USERNAME/$LIST_ID" \
| jq '.ingredients | map({id, name})'

# 2. remove the one that matched
curl -s -X POST -H "authorization: Bearer $FP" -H 'content-type: application/json' \
  -d "{\"lists\":[{\"id\":\"$LIST_ID\",\"name\":\"$LIST_NAME\",\"removeIds\":[\"<that id>\"]}]}" \
  https://fortypirates.com/api/drawer/lists
```

Never call place-search to remove something — the id you need is already in the list.
If two members match the name, ask which; if none do, say so rather than removing the
nearest thing.

**A map is the same list, opened on its map.** There is no separate endpoint and nothing
extra to create — append `?view=map` to the url the call returned:

```
cards   https://fortypirates.com/@{username}/kyoto-matcha-cafes
map     https://fortypirates.com/@{username}/kyoto-matcha-cafes?view=map
```

So "make me a map of X" and "make me a list of X" are one request; only the link you
hand back differs. Give the map url when the user asked for a map, plotted a route, or
said anything about where the places are relative to each other.

## Lists — everything is `POST /api/drawer/lists`

Read them first; the id is what every write needs:

```bash
curl -s -H "authorization: Bearer $FP" https://fortypirates.com/api/drawer/lists \
| jq '.lists | map({id, name, count:(.ingredientIds|length)})'
```

One endpoint does create, rename, add, remove, and delete — this is exactly what the web
app itself calls, so anything it can do, you can do:

```bash
L=https://fortypirates.com/api/drawer/lists
H=(-H "authorization: Bearer $FP" -H 'content-type: application/json')

# create — YOU generate the id (uuid). Both id and name are required, always.
ID=$(uuidgen)
curl -s -X POST "${H[@]}" -d "{\"lists\":[{\"id\":\"$ID\",\"name\":\"Japan 2026\",\"ingredientIds\":[]}]}" $L

# add — ingredientIds UNIONS into the list. Send only what you're adding.
curl -s -X POST "${H[@]}" -d "{\"lists\":[{\"id\":\"$ID\",\"name\":\"Japan 2026\",\"ingredientIds\":[\"ChIJ…\"]}]}" $L

# remove — a separate field. ingredientIds can never remove anything.
curl -s -X POST "${H[@]}" -d "{\"lists\":[{\"id\":\"$ID\",\"name\":\"Japan 2026\",\"removeIds\":[\"ChIJ…\"]}]}" $L

# rename — same shape, new name
curl -s -X POST "${H[@]}" -d "{\"lists\":[{\"id\":\"$ID\",\"name\":\"Japan, spring\"}]}" $L

# delete the list — destructive, confirm with the user first
curl -s -X POST "${H[@]}" -d "{\"deleteIds\":[\"$ID\"]}" $L
```

Three rules this endpoint enforces, each of which returns
`{"error":"lists or deleteIds required"}` if you get it wrong:

- **`id` AND `name` are both required on every entry.** An entry missing either is
  silently dropped, and a request with nothing left is a 400. Always re-send the name,
  even when you're only changing membership.
- **Creating means supplying your own id** — there is no server-generated one.
- **Adding and removing are different fields.** `ingredientIds` unions; `removeIds`
  subtracts.

Every response returns the user's full list set, so read `.lists` back to confirm what
changed instead of assuming.

Reading one list's contents (public, resolves each member from its source document):

```bash
curl -s "https://fortypirates.com/api/lists/$USERNAME/$LIST_ID" | jq '{name, count:(.ingredients|length)}'
```

## Rules

- **This is the user's real, live data.** Creating a list, adding to one, removing from
  one, and deleting are all immediate and visible in their app. Confirm before deleting a
  list or removing several ingredients. Do NOT confirm reads, a single add, or building a
  list from names — those are cheap and undoable, and asking wastes the user's turn.
- **Report what changed** — "added 3 places to Japan 2026", not the raw JSON.
- **Never invent an ingredient id.** Every id you write must have come from a response
  you actually read. There is no endpoint here for creating an ingredient — those come
  from extracting a video or article in the app.
- A `401` means expired or revoked: point at the settings page, stop.
- A `404` on a list path usually means the id is stale — re-read `/api/drawer/lists`.
