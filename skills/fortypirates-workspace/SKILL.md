---
name: fortypirates-workspace
description: |
  Read and change the user's Forty Pirates workspace — their saved places, dishes, and
  experiences, and the lists those live in. Search what they've saved, list their
  lists, see what's in one, create a list, map or trip, move ingredients in and out of
  it, put a list in order, arrange a trip's days, read a video or article into
  ingredients, and search places other people shared. Also turns a movie, anime or show title into a saved map of its
  real filming or pilgrimage locations, and how another MCP host connects to the
  same tools.
  Use when the user asks about "my saved places", "my lists", "my workspace", "what did I
  save in Tokyo", "put that in my Japan list", "make me a map of…", "plan my Kyoto trip",
  "what's good near Shibuya", "what places are in this video", "where was Your Name
  filmed", "anime pilgrimage spots for…", or "connect Forty
  Pirates to Claude Desktop / add the MCP server", or asks to organise,
  find, or add to their own saved travel content. Plain HTTPS against fortypirates.com — no install.
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
(a micro-experience — a walk, an afternoon), `mention` (a creator's line about a
place), `tip`, `food`, `activity`, `product`, `event`, `collection`, `source`.

**The full snapshot** — only when you need fields the slim projection drops (tags,
source attribution, mentions). It is 150–700 KB; never fetch it to answer "what did I
save", and never paste it into a reply.

```bash
curl -s -H "authorization: Bearer $FP" \
  https://fortypirates.com/api/profile/global-storefront/snapshot | jq '.stubs | length'
```

## Reading a video or article into ingredients

The other way things get into a workspace: point at a post and get back what it
mentions. Nothing is saved — you keep what the user wants, by name, with the list calls
below.

```bash
curl -s -X POST -H 'content-type: application/json' \
  -d '{"url":"https://www.youtube.com/watch?v=…","quick":true}' \
  https://fortypirates.com/api/content/extract-shape \
| jq '{title: .data.videoTitle, place: .data.primaryLocation,
       ingredients: [.data.ingredients[] | {name, kind, note: .highlight}]}'
```

- `quick: true` is the fast pass — POIs and the items a creator called out. Leave it off
  only if the user explicitly wants the slow, deeper read; it can run past a minute.
- Works for YouTube, TikTok, Instagram and plain articles. TikTok share links resolve
  themselves.
- **Cached by url**, so a post someone has already read comes back in seconds.
- `ingredients[]` is the canonical list; `pois[]`/`tips[]` are the same objects grouped
  by kind, and older documents have only those.
- The creator's line about a place lives in `highlight`. Carry it over as `note` when you
  save, or it is lost and the place becomes an anonymous pin.

## Building a list

A list holds **ingredients**, and a place is one kind of them. `type` decides what
happens to each member:

| type | what it is | what happens |
|---|---|---|
| `poi` (default) | a place | looked up and saved with a photo |
| `me` (or `experience`) | an ordered route through places | its `stops` are looked up, order kept; a `me` with no stops is dropped |
| `food` `tip` `activity` `product` `event` `hotel` | a dish, a note, a thing to do, a place to stay | stored as given — nothing to look up |

The minimum for any of them is a **name and a type**. A bare string is a place.
Those are the only types read: any other `type` (or a member with no name) is
**silently dropped**, so the call succeeds having saved less than you sent — count
what came back in `saved`/`ingredients` rather than assuming.

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

**One box, three doors.** A list, its map and a trip are the same thing opened
differently. `view` picks which url comes back as `url`; all three always come back, so
offering the other view costs nothing.

| `view` | what it makes | `url` |
|---|---|---|
| `list` (default) | a list | `/@user/{slug}` |
| `map` | the same list, opened on the map | `/@user/{slug}/map` |
| `plan` (or `trip`) | a **trip** — a list with a day-by-day plan | `/@user/{slug}/trip` |

Only `plan` changes what is stored: it adds the plan that makes the list a trip.
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
- Max 50 **grounded places** per call — `poi` members and `me` stops; dishes and
  tips don't count against it. Only places are looked up, so a list of dishes and
  tips is instant.
- The list is PRIVATE by default.

## Lists — everything is `POST /api/drawer/lists`

Read them first; the id is what every write needs:

```bash
curl -s -H "authorization: Bearer $FP" https://fortypirates.com/api/drawer/lists \
| jq '.lists | map({id, name, count:(.ingredientIds|length)})'
```

One endpoint does create, rename, add, remove, order, and delete — this is exactly what the web
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

# order the list — sequence is the members, in the order you want them shown
curl -s -X POST "${H[@]}" -d "{\"lists\":[{\"id\":\"$ID\",\"name\":\"Japan 2026\",\"sequence\":[\"ChIJ…\",\"ing_me_…\"]}]}" $L

# unorder it — an EMPTY array clears the sequence; omitting the field leaves it alone
curl -s -X POST "${H[@]}" -d "{\"lists\":[{\"id\":\"$ID\",\"name\":\"Japan 2026\",\"sequence\":[]}]}" $L

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

**Ordering a list — `sequence`.** A list is unordered by default. Send `sequence` with
the member ids in the order you want and the list becomes *sequenced*: every card gets
its position number and the map draws a route through the places in that order. Get the
ids from a read first — `ingredientIds` on `/api/drawer/lists`, or `ingredients[]` on
`/api/lists/{owner}/{id}`.

- **Absent leaves it alone, `[]` clears it.** Only an empty array reverts the list to
  unordered; omitting the field on an add or a rename never disturbs the order.
- **The stored order is reconciled against membership on every read.** Ids that are no
  longer members are dropped, a repeated id counts once, and members you left out are
  appended at the end — so a partial order is legal and you never have to re-send the
  whole list to move one place.
- **A trip ignores it.** The plan owns the order of a trip's places; arrange its days
  instead (below).
- Reads carry it back: `.sequence` on both `/api/drawer/lists` and
  `/api/lists/{owner}/{id}`, absent when the list is unordered.

Reading one list's contents — resolves each member from its source document, so this is
where the creator commentary and notes live:

```bash
curl -s -H "authorization: Bearer $FP" \
  "https://fortypirates.com/api/lists/$USERNAME/$LIST_ID" | jq '{name, count:(.ingredients|length)}'
```

Send the key. A private list answers `403 {"error":"forbidden"}` without it — including
to its own owner, because there is no session to resolve.

**Trips are hidden from this endpoint by default.** `/api/drawer/lists` returns lists
only; a list carrying a plan has its own place in the app. Ask for them by id:

```bash
curl -s -H "authorization: Bearer $FP" \
  'https://fortypirates.com/api/drawer/lists?includeTrips=1' \
| jq '.lists | map({id, name, isTrip:(.hasPlan // false), count:(.ingredientIds|length)})'
```

Without `includeTrips=1` a trip is invisible, and adding to one answers
`404 no list with id …` about a list the user can plainly see.

## The plan — arranging the days

A trip is a list with a plan, and the plan sits ON TOP of the list's
ingredients — it references them, it holds no copies of its own. Three rules follow, and
they are the whole model:

- **Everything in the list is in the plan, unscheduled**, until it is put on a day.
- **Putting something on a day puts it in the list.** Schedule an ingredient the user
  has saved but that this list doesn't hold, and it is added. An id they have
  never saved comes back in `notFound` and nothing is written.
- **Unschedule ≠ remove.** Unscheduling takes something off a day and leaves it in the
  list. Removing takes it out of the list — so it leaves the plan too, and
  off any day it was on.

A list with no plan is not an error: `GET` answers `hasPlan: false` with everything
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
- **Dropping the plan** turns a trip back into a plain list and keeps every ingredient:

```bash
curl -s -X DELETE "${H[@]}" "https://fortypirates.com/api/boxes/$LIST_ID/schedule"
# → { "ok": true, "hadPlan": true, "keptIngredients": 12 }
```

  Only the days and their arrangement go, and they cannot be recovered — confirm first
  if the user arranged anything.

You are the one arranging it: group by neighbourhood, keep travel between stops short,
temples and markets early, bars late. Read the schedule back and tell the user the shape
of each day, not the JSON.

## Discover — the public read side

Everything above is the user's own workspace. The discover routes are the other
direction: places, dishes and experiences other people published, out of the global
storefront snapshot. **No key needed** — these are public.

Discover returns **ingredients** — a place, a dish, a tip, an activity — never
entities. There is no anime or movie in the discover index; those live behind
`/explore`. If the user asks for an anime's locations, see "Turning a title into
places" below.

### Filter — `GET` or `POST /api/discover/filter`

The workhorse — the public search surface over the storefront snapshot. With
`owner` it reads that creator's global snapshot; without it, the cross-owner
discover aggregate.

| param | type | what it does |
|---|---|---|
| `owner` | string | One creator's shelf instead of everyone's. Omit for the cross-owner aggregate. |
| `chips` | comma-separated strings | Tag facets. OR within a prefix section, AND across sections. e.g. `city:tokyo`, `city:kyoto,city:osaka` (either city). Matched as **exact, lowercase keys** into the snapshot's own facets — no normalising. GET trims whitespace around the commas; POST does not trim at all, so a padded array element fails there. `city:Tokyo` or `city: tokyo` matches nothing on either verb, and when *every* chip is unknown the answer is **zero stubs**, not everything, with HTTP 200 and no error. One unknown chip among known ones is silently dropped, which quietly widens the result set. Take chips from the snapshot's facet list rather than building them from the user's words. |
| `kinds` | comma-separated strings | `poi`, `mention`, `tip`, `item`, `food`, `activity`, `product`, `event`, `collection`, `me`, `source`. Default: all — including the kinds you may not want, so pass `kinds` explicitly. |
| `q` | string | Free-text substring match on the stub's title, case-insensitive. |
| `near` | `lat,lng` | Great-circle gate + nearest-first sort around this point. GET only takes the `"lat,lng"` string form. Effectively **poi-only**: any stub without `lat`/`lng` is dropped outright, and only `poi` stubs are geocoded — so `near` with `kinds=food`, `item` or `tip` returns near-zero results with HTTP 200. Search those by `chips`/`q` instead. |
| `radiusMi` | number | Radius for `near`, in miles. **No default.** Omit it and there is no radius cap at all — you get the whole matching set sorted nearest-first, so a "nearby" answer built from it can include places on another continent. Always send it with `near`. (The 3-mile default belongs to the `search_places` MCP tool, not this route.) |
| `limit` | number | Page size. |
| `offset` | number | Skip this many before applying `limit`. |

GET takes these as query parameters. POST takes the same fields as JSON, with two
differences: `chips` and `kinds` are arrays, and `near` is an **object** —
`{"lat":35.66,"lng":139.70,"radiusMi":3}`. There is no top-level `radiusMi` in the
POST body and no `"lat,lng"` string parsing; a string `near` is passed through
un-parsed and silently produces garbage, with no error: stubs without coordinates
are dropped, every stub *with* coordinates gets a `NaN` distance, no radius cap
applies, and the nearest-first sort compares `NaN` — so you get a full,
arbitrarily-ordered set rather than an empty one.

The array types matter too. `chips` and `kinds` are read only when they are
arrays: `{"chips":"city:tokyo"}` becomes no chip filter at all (the whole
snapshot) and `{"kinds":"poi"}` becomes all kinds. Both widen the result set
silently. Always send them as arrays.

Nothing else in the POST body is type-checked either — `q`, `limit` and `offset`
are passed straight through. Send `q` as a string and `limit`/`offset` as
numbers; a wrong type is not rejected with a 400, it throws inside the filter and
comes back as a 500.

```bash
# places in a city — chips are the storefront's own facets
curl -s 'https://fortypirates.com/api/discover/filter?kinds=poi&chips=city:tokyo&limit=12' \
| jq '.stubs | map({name:.title, lat, lng, creator:.source.creatorName})'  # creator may be null

# what is NEAR here — within 3 miles of a point
curl -s 'https://fortypirates.com/api/discover/filter?near=35.6595,139.7005&radiusMi=3&kinds=poi'

# dishes, experiences, tips
curl -s 'https://fortypirates.com/api/discover/filter?kinds=food&chips=city:kyoto'

# free-text title search
curl -s 'https://fortypirates.com/api/discover/filter?q=ramen&kinds=food&limit=10'

# one creator's shelf instead of everyone's
curl -s 'https://fortypirates.com/api/discover/filter?owner=someone&kinds=poi'

# same nearby query as POST — note `near` is an object, radiusMi lives inside it
curl -s -X POST -H 'content-type: application/json' \
  -d '{"kinds":["poi"],"near":{"lat":35.6595,"lng":139.7005,"radiusMi":3},"limit":12}' \
  https://fortypirates.com/api/discover/filter
```

Returns `{ total, count, stubs[] }` — except when the snapshot is missing, where
the body is `{ total: 0, stubs: [] }` with no `count`. Read the length of `stubs`
rather than keying on `count`.

An `owner` that does not exist reads a key that isn't there and returns that same
`{ total: 0, stubs: [] }` with HTTP 200 — a misspelt handle is indistinguishable
from a real creator with an empty shelf, so check the spelling before telling the
user someone has saved nothing. A `500 { "error": "R2 unavailable" }` is the only
hard failure. On GET, a non-numeric `radiusMi`, `limit` or `offset` is dropped
rather than rejected, so `radiusMi=abc` silently removes the radius cap. `near`
on GET must be two finite numbers, `lat,lng` — `near=Shibuya` or a lone
`near=35.6` drops the whole geo gate and hands back the full newest-first set.

`total` is the match count **before** `limit`/`offset`; `count` is the length of
the page you were handed. With `limit=12` against 400 matches you get
`total: 400, count: 12` — report the 12 you hold, say there are more, and page
through with `offset` if the user wants them.

Ordering: with `near` the page is sorted **nearest-first**; without it,
**newest-written first**. There is no relevance ranking, so `?q=ramen&limit=10`
hands back the ten most recently written matches — present it as recent, not as
the best ten.

Every stub carries `id`, `kind` and `ref`. `title`, `image`, `tags[]` and `brief`
(the card blurb) are common but **optional** — a stub with no image or no tags is
normal, and a missing `title` simply never matches `q`. `writtenAt` is what the
default sort keys on, and `src` is the unresolved source token behind a missing
creator name. `lat`/`lng` are there when the ingredient is a geocoded place
(`poi`); dishes, tips and items generally have neither. `image` is sometimes a
**bare R2 key** (`media/…`) and sometimes an
already-absolute URL (a foreign thumbnail that was never rewritten). Prefix it
only when it does **not** start with `http` — `https://cache.contextforce.com/<key>`
in prod, `http://localhost:8787/api/cached-image/<key>` in dev. Prefixing a value
that is already a URL renders nothing. It
*sometimes* carries `source` with a `creatorName`: compacted snapshots replace the
inline `source` with a token the filter route does not resolve, so roughly a third
of stubs name a creator and the rest do not. The token is resolvable, just not
here — `filter` returns stubs only, never the snapshot's `sources` map, so
`src` can only be looked up through `GET /api/discover/snapshot` (below).

- When a stub does carry `source.creatorName`, name that person when you report the
  place — a recommendation with a voice behind it beats a bare pin. When it does
  not, report the place without one; never guess a creator, and never call the
  missing attribution an error.
- These ids are other people's saves. To keep one for the user, add it **by name** with
  `add_to_list` or `create_list`, which grounds it into their own workspace.
- It reads a snapshot, so it reflects the last rebuild rather than the last second.

### Snapshot — `GET /api/discover/snapshot`

The full bitmap + stubs blob the `/discover` page renders from. Large (hundreds
of KB to several MB). Prefer `filter` unless you need the raw tag bitmaps for
client-side filtering.

| param | type | what it does |
|---|---|---|
| `owner` | string | One user's global snapshot. Omit for the cross-owner discover aggregate. |

Supports ETag/If-None-Match; the response is edge-cached (`s-maxage=86400`).

Returns `{ version, writtenAt, ownerUsername, slug, ingredientIds[], stubs{},
sources?{}, tagsBase64{} }`. `ingredientIds` is bit-position order for the
`tagsBase64` bitmaps and may name ids that are no longer in `stubs` — filter on
`stubs[id]` rather than trusting the id list. `sources` is the deduped source map
a stub's `src` token points into: prefer a stub's inline `source` when it has one
and fall back to `sources[stub.src]`. This is the only public route that hands
back that map, so it is how a creator name gets resolved for a stub `filter` left
anonymous. It is absent on snapshots written before the map existed.

A missing snapshot — including an unknown `owner` — comes back as HTTP 200 with a
fully-shaped but empty body: `writtenAt: ""`, `ingredientIds: []`, `stubs: {}`,
`tagsBase64: {}`. There is no `error` field to check, so test `ingredientIds.length`
rather than looking for a failure. The one real error is
`500 { "error": "R2 unavailable" }`.

### Geo — `GET /api/discover/geo`

A compact index for the atlas map: every `city:<slug>` rolled up to its mean
POI coordinate and count. One `{lat, lng, n}` per slug — tiny compared to
the full snapshot.

Returns `{ writtenAt, slugs: { [slug]: { lat, lng, n, img? } } }`. No
parameters. Edge-cached. `writtenAt` is only a real timestamp on the happy path —
it comes back as `""` when the snapshot is missing and is absent entirely when the
bucket is unbound, so don't treat it as always parseable. `img` follows the same
bare-key-or-URL rule as a stub's `image`.

## Turning a title into places

This is a recipe, not an endpoint. When the user names a movie, anime or show and
wants the places it was filmed at or based on, **your own web search does the
finding** — on your tokens — and the API does the place lookup, photos and the
shareable view.

1. **Search the web** for the title plus "filming locations", "real locations",
   or "pilgrimage spots". Read the top results. Each hit becomes a place with a
   **name**, a **city**, and a **note** saying why it belongs (the scene, the
   episode, what to look for).

2. **Cite the source.** When a place came from an article, carry `sourceName`
   (the site or author) and `sourceUrl` (the article, not the homepage) so it
   renders in that source's voice with a link and a favicon.

3. **Save the whole set in one call** with `POST /api/lists/from-names` — or the
   MCP `create_list` tool, which calls the same thing. Pass `view: "map"` for a
   pin map, or `view: "plan"` for a trip with days — `"trip"` is accepted as an
   alias for `"plan"` on either surface. **Max 50 places per call**
   (counting `poi` members and `me` stops; dishes and tips don't count) — over
   that the whole request fails with `400 too many places (N); max 50` and
   nothing is saved. For a longer set, create the list with the first 50 and
   append the rest in further `add_to_list` calls.

No Forty Pirates search is involved. No new endpoint. The API grounds each name
to a real place, fetches a photo, and hands back a shareable link.

### Worked example — Your Name (Kimi no Na wa)

```bash
# You searched the web and found these locations. Now save them:
curl -s -X POST -H "authorization: Bearer $FP" -H 'content-type: application/json' \
  -d '{
    "name": "Your Name — real locations",
    "view": "map",
    "near": "Tokyo",
    "ingredients": [
      {"type":"poi", "name":"Suga Shrine", "city":"Tokyo",
       "note":"The stairway where Taki and Mitsuha finally meet.",
       "sourceName":"Japan Guide", "sourceUrl":"https://www.japan-guide.com/e/e2164.html"},
      {"type":"poi", "name":"Café La Bohème Shinjuku", "city":"Tokyo",
       "note":"The café where Okudera-senpai and Taki have their date."},
      {"type":"poi", "name":"Hida Furukawa Station", "city":"Hida, Gifu",
       "note":"Inspiration for the Itomori train station. The platform and plaza match the film frame for frame."},
      {"type":"poi", "name":"Hida City Library", "city":"Hida, Gifu",
       "note":"Where Taki researches the comet disaster."},
      {"type":"poi", "name":"Lake Suwa", "city":"Suwa, Nagano",
       "note":"Basis for the crater lake surrounding Itomori."}
    ]
  }' \
  https://fortypirates.com/api/lists/from-names
# → { url: "/@you/your-name-real-locations/map", listId: "…", saved: [...], notFound: [], … }
```

The response hands back `url` (the map), `listUrl`, `mapUrl` and `planUrl` — all
three views of the same list. See "Building a list" above for the full shape.

Partial success is normal and comes back as HTTP 200: any name the API could not
ground to a real place lands in `notFound[]` while the rest are saved. Read
`notFound` before reporting, and name the places that did not resolve instead of
claiming the whole set was saved.

## MCP — for hosts that are not Claude Code

This skill is how Claude Code talks to the workspace. `POST /api/mcp` is how
every other host does — Claude Desktop, claude.ai, ChatGPT, or any client that
speaks MCP's Streamable HTTP transport. It is a route handler on the same app,
not a second worker, so it shares the same auth, the same data and the same
deploy.

The transport is stateless JSON-RPC over POST: no session id, no SSE. Every
request carries its own `Authorization: Bearer fp_pat_…` — the same key the
skill already uses.

`initialize`, `ping`, `tools/list`, `prompts/list`, `prompts/get` and the
`resources/*` probes answer **without auth** — nothing there is user data, only
the shape of what is on offer. `initialize` echoes the client's
`protocolVersion` when it is one of `2024-11-05`, `2025-03-26`, `2025-06-18`, and
otherwise answers `2024-11-05` rather than failing the handshake. `resources/list`
and `resources/templates/list` come back empty on purpose — this server offers
tools and prompts, not resources. Only `tools/call` needs the key.

A tool that fails does **not** come back as a JSON-RPC error: it is a normal
result with `isError: true` and the message as its text. So is an unknown tool
name. Read `isError` — a `200` with an `error`-free envelope is not proof the
call worked.

### Available tools

| tool | what it does |
|---|---|
| `search_saved_places` | Search what the user already saved — by name, kind, or both. |
| `extract_from_url` | Read a video or article into ingredients. Nothing is saved. |
| `my_lists` | The user's lists, with counts. A trip shows `isTrip`. |
| `get_list` | What is inside one list — places, dishes, tips, experiences. |
| `create_list` | Build a new list, map or trip from names. |
| `add_to_list` | Add members to an existing list. |
| `remove_from_list` | Remove one member by id. |
| `delete_list` | Delete a whole list (destructive). |
| `get_plan` | Read a trip's day-by-day schedule. |
| `update_plan` | Put things on days — schedule, move, unschedule. |
| `delete_plan` | Drop a trip's plan, turning it back into a plain list. |
| `search_places` | Discover places other people shared — the public side. |

These tools wrap the same workspace verbs documented above, but they are **not** a
1:1 rename of the HTTP parameters. `search_places` takes `query`, `city`, `near`,
`radiusMiles` (default 3) and a singular `kind` where the filter route takes `q`,
`chips`, `radiusMi` and a plural `kinds`. A wrong argument
name is silently ignored, not rejected — read `tools/list` for each tool's exact
schema rather than translating from the HTTP section.

### Connecting a host

Add `https://fortypirates.com/api/mcp` as a remote MCP server (Claude Desktop and
claude.ai call it a custom connector; other hosts call it a remote/HTTP MCP
server) and give it the same `fp_pat_…` key from "Connecting (once per machine)"
above as an `Authorization: Bearer` header. A host that can do OAuth instead needs
no key: an unauthenticated call answers `401` with an RFC 9728 `WWW-Authenticate`
header pointing at the resource metadata, and the host takes it from there.

```bash
# list available tools (no auth needed for the manifest)
curl -s -X POST -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' \
  https://fortypirates.com/api/mcp

# a plain GET answers the same manifest, for a host (or a human) that probes first
curl -s https://fortypirates.com/api/mcp
# → { name, version, transport: "streamable-http", protocolVersion, tools: [ …names ] }
```

### This procedure, as an MCP prompt

The host also gets this document. `prompts/list` offers one prompt,
`fortypirates-workspace`, with no arguments, and `prompts/get` returns the body of
this skill as a user message — so a client with no access to this repo can still
pick it and follow it.

```bash
curl -s -X POST -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"prompts/get","params":{"name":"fortypirates-workspace"}}' \
  https://fortypirates.com/api/mcp
```

A prompt is **user-invoked**, never model-invoked: it makes the procedure
available to somebody who asks for it and will never fire on its own. The body is
read from R2 at request time, so it is whatever was last synced there rather than
whatever this file says today; an unsynced prompt answers
`-32602 Unknown or unavailable prompt` instead of a stale guess.

## Whose search, whose extraction

If you already have web search or page fetch, use yours. The user's workspace
API is free infrastructure: saving, listing, arranging, sharing — none of that
costs extraction budget.

Forty Pirates' own `extract_from_url` (or the equivalent
`POST /api/content/extract-shape`) is the fallback for what nothing else can do:
reading a TikTok, Instagram reel, or YouTube video that most models cannot watch
or fetch. When the user pastes a social video link and you have no way to read it
yourself, that is when extraction earns its keep.

The boundary is capability, not price. Extraction may be limited in future, so
prefer your own tools when they can reach the content.

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
