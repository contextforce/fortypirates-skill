---
name: fortypirates-workspace
description: |
  Read and change the user's Forty Pirates workspace — their saved places, dishes, and
  experiences, and the lists those live in. Search what they've saved, list their
  collections, see what's in one, create a list, map or trip, move ingredients in and out
  of it, arrange a trip's days, and find or copy collections other people published.
  Use when the user asks about "my saved places", "my lists", "my workspace", "what did I
  save in Tokyo", "put that in my Japan list", "make me a map of…", "plan my Kyoto trip",
  "find a Kyoto itinerary someone made", or asks to organise, find, or add to their own
  saved travel content. Plain HTTPS against fortypirates.com — no install.
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

Returns `{url, listUrl, mapUrl, planUrl, view, listId, saved[], experiences[], ingredients[], notFound[]}`.

**One box, three doors.** A list, a map and a trip are the same collection opened
differently. `view` picks which url comes back as `url`; all three always come back, so
offering the other view costs nothing.

| `view` | what it makes | `url` |
|---|---|---|
| `list` (default) | a list | `/@user/{slug}` |
| `map` | the same collection, opened on the map | `/@user/{slug}/map` |
| `plan` (or `trip`) | a **trip** — a list with a day-by-day plan | `/@user/{slug}/trip` |

Only `plan` changes what is stored: it adds the plan that makes the collection a trip.
Pass `days` (1–30, default 7) for how long it runs.

```bash
curl -s -X POST "${H[@]}" \
  -d '{"name":"Kyoto, spring","view":"plan","days":3,"near":"Kyoto",
       "ingredients":["Kiyomizu-dera","Nishiki Market","Fushimi Inari Taisha"]}' \
  https://fortypirates.com/api/lists/from-names
```

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
- The list is PRIVATE by default.

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

Reading one list's contents — resolves each member from its source document, so this is
where the creator commentary and notes live:

```bash
curl -s -H "authorization: Bearer $FP" \
  "https://fortypirates.com/api/lists/$USERNAME/$LIST_ID" | jq '{name, count:(.ingredients|length)}'
```

Send the key. A private list answers `403 {"error":"forbidden"}` without it — including
to its own owner, because there is no session to resolve.

**Trips are hidden from this endpoint by default.** `/api/drawer/lists` returns lists
only; a collection carrying a plan has its own place in the app. Ask for them by id:

```bash
curl -s -H "authorization: Bearer $FP" \
  'https://fortypirates.com/api/drawer/lists?includeTrips=1' \
| jq '.lists | map({id, name, isTrip:(.hasPlan // false), count:(.ingredientIds|length)})'
```

Without `includeTrips=1` a trip is invisible, and adding to one answers
`404 no list with id …` about a collection the user can plainly see.

## The plan — arranging the days

A trip is a collection with a plan, and the plan sits ON TOP of the collection's
ingredients — it references them, it holds no copies of its own. Three rules follow, and
they are the whole model:

- **Everything in the collection is in the plan, unscheduled**, until it is put on a day.
- **Putting something on a day puts it in the collection.** Schedule an ingredient the
  user has saved but that this collection doesn't hold, and it is added. An id they have
  never saved comes back in `notFound` and nothing is written.
- **Unschedule ≠ remove.** Unscheduling takes something off a day and leaves it in the
  collection. Removing takes it out of the collection — so it leaves the plan too, and
  off any day it was on.

A collection with no plan is not an error: `GET` answers `hasPlan: false` with everything
unscheduled, and the first `POST` writes the plan. There is no "convert to trip" step.

Read the plan. Ids here are what the write takes; names are for showing the user:

```bash
curl -s -H "authorization: Bearer $FP" \
  "https://fortypirates.com/api/boxes/$LIST_ID/schedule" \
| jq '{days: [.days[] | {day, morning: [.morning[].name], afternoon: [.afternoon[].name], evening: [.evening[].name]}],
       unscheduled: [.unscheduled[].name]}'
```

Arrange it — schedule, move, unschedule, resize, in one call:

```bash
curl -s -X POST "${H[@]}" -d '{
  "schedule": [
    {"ingredientId":"ChIJ…","day":1,"zone":"morning"},
    {"ingredientId":"ing_food_yuba-don","day":1,"zone":"evening","position":0}
  ],
  "unschedule": ["ChIJ…"],
  "days": 4
}' "https://fortypirates.com/api/boxes/$LIST_ID/schedule"
```

- `zone` is `morning`, `afternoon` or `evening`; default `morning`.
- `position` is where in that zone, `0` first, omitted last. The order is what the user
  reads as the order of the day.
- Scheduling something already on a day **moves** it — it is never in two places.
- A `day` beyond the end **grows the trip** (max 30) rather than failing; the response
  reports the new `days`.
- Ids not in the trip come back in `notInTrip` and nothing else in the batch is lost.
- `hasPlan: false` on the read means no plan yet; posting `days` (or any `schedule`
  entry) creates one, and the response says `planCreated: true`.

You are the one arranging it: group by neighbourhood, keep travel between stops short,
temples and markets early, bars late. Read the schedule back and tell the user the shape
of each day, not the JSON.

## Other people's collections

Everything above is the user's own workspace. Published lists and trips — anyone's —
are one endpoint, and it needs no key:

```bash
curl -s 'https://fortypirates.com/api/collections/public?q=kyoto&kind=trip&limit=10' \
| jq '.collections | map({name, boxId, owner, count, city, url})'
```

- `q` matches the name **or** the city; `kind` is `trip` or `list` (omit for both);
  `owner` narrows to one creator's public shelf; `limit` maxes at 100.
- Each result carries `url`, `mapUrl`, and `planUrl` for a trip — prefix them with
  `https://fortypirates.com`.

Copying one into the user's own workspace, with their key:

```bash
curl -s -X POST "${H[@]}" -d '{"owner":"someone","id":"BOX_ID"}' \
  https://fortypirates.com/api/lists/clone
# → { "id": "…", "slug": "…" }   the user's own copy, at /@{their-username}/{slug}
```

The copy is theirs and private: every place, dish and tip comes across, a copied trip
keeps its day-by-day plan, and the places land in their workspace as if they had saved
them. It is a snapshot, not a subscription — later edits by the original owner don't
reach it.

**Confirm before copying.** It adds real places to their workspace and shows up in their
lists, which is not what someone browsing expects to have happened.

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
- A `404` on a list path usually means the id is stale — re-read `/api/drawer/lists`,
  with `?includeTrips=1` if it might be a trip.
- **Give them the right link.** A map for "where are these", the planner for a trip, the
  list otherwise — the response hands you all three.
