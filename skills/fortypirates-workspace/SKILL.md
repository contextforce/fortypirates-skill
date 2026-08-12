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

Check first — usually already done:

```bash
FP="${FP_TOKEN:-$(cat ~/.config/fortypirates/token 2>/dev/null)}"
[ -n "$FP" ] && curl -s -o /dev/null -w '%{http_code}' -H "authorization: Bearer $FP" \
  https://fortypirates.com/api/pirates/me   # 200 = connected, 401 = reconnect
```

If there's no key, run the connect flow. It is three curls and no runtime:

```bash
# 1. ask for a code
curl -s -X POST -H 'content-type: application/json' -d '{"name":"claude-code"}' \
  https://fortypirates.com/api/cli/device
# → { "deviceCode": "…", "userCode": "69YT-CKQ5",
#     "verifyUrl": "https://fortypirates.com/cli-auth?code=69YT-CKQ5", "interval": 3 }
```

Show the user the **verifyUrl** and tell them to click **Allow** — nothing to copy,
nothing to paste. Then poll with the `deviceCode` every few seconds:

```bash
# 2. poll until approved (max ~10 minutes; 410 means it expired, start over)
curl -s "https://fortypirates.com/api/cli/device?code=$DEVICE_CODE"
# → {"status":"pending"}  … then  {"status":"approved","token":"fp_pat_…"}
```

```bash
# 3. save it — the key is handed over ONCE, so store it before doing anything else
mkdir -p ~/.config/fortypirates && chmod 700 ~/.config/fortypirates
printf '%s\n' "$TOKEN" > ~/.config/fortypirates/token && chmod 600 ~/.config/fortypirates/token
```

Every later command reads that file. **Never print the key**, never echo it into a
reply, never write it anywhere else. A `401` means it was revoked or expired —
reconnect, don't retry the call.

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

## Building a list

A list holds **ingredients**, and a place is one kind of them. `type` decides what
happens to each member:

| type | what it is | what happens |
|---|---|---|
| `poi` (default) | a place | looked up and saved with a photo |
| `me` | an ordered route through places | its `stops` are looked up, order kept |
| `food` `tip` `activity` `product` `event` | a dish, a note, a thing to do | stored as given — nothing to look up |

The minimum for any of them is a **name and a type**. A bare string is a place.

```bash
curl -s -X POST -H "authorization: Bearer $FP" -H 'content-type: application/json' \
  -d '{"name":"Kyoto day","near":"Kyoto","ingredients":[
        {"type":"poi","name":"Kaikado Cafe","city":"Kyoto",
         "note":"Tin tea caddies, quiet upstairs room."},
        {"type":"food","name":"Matcha parfait","poiRef":"Kaikado Cafe"},
        {"type":"tip","name":"Go before 10am"},
        {"type":"me","name":"Higashiyama morning","narrative":"Temples, then coffee.",
         "stops":["Kiyomizu-dera","Yasaka Shrine"]},
        "Nishiki Market"]}' \
  https://fortypirates.com/api/lists/from-names
```

Returns `{url, saved[], experiences[], ingredients[], notFound[]}`.

- **Say where each place is.** `city`/`country` per place, or `near` as the default.
  A chain with no city goes wherever Google ranks it — "Blue Bottle" alone lands in
  New York. `searchedNear` in the response says what each was matched against.
- **`note` says why it is on the list.** With `sourceName` + `sourceUrl` it renders as
  that source's voice, linked, with the site's favicon; without them it is the user's
  own note. Cite when it came from somewhere — and cite the ARTICLE, not the homepage.
- **Adding to an existing list** is the same call with `listId` instead of `name`.
- **Removing** takes the member's id via `removeIds` (see below). An experience's id
  looks like `ing_me_…`; removing it leaves its places in the list.
- **Cover image** defaults to the first place's photo; pass `coverImage` (any url — it
  is cached) to choose, or `""` to clear. An append never repaints it.
- Max 50 members. Only places are looked up, so a list of dishes and tips is instant.
- The list is PRIVATE by default. Its map is the same url with `?view=map`.

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
