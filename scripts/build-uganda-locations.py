#!/usr/bin/env python3
"""
Builds packages/delivery/data/uganda-locations.json.gz from
https://github.com/kusaasira/uganda-geo-data (MIT, sourced from Uganda's
passport portal). Adds regions, merges duplicate divisions, tidies names.

  git clone --depth 1 https://github.com/kusaasira/uganda-geo-data /tmp/ugd
  python3 scripts/build-uganda-locations.py /tmp/ugd/src/Uganda/Data

Output: [[region, [[district, [[division, [[parish, [village, ...]], ...]], ...]], ...]], ...]
"""
import gzip, json, re, sys
from collections import defaultdict

REGIONS = {
  "Central": "Buikwe Bukomansimbi Butambala Buvuma Gomba Kalangala Kalungu Kampala Kasanda Kayunga Kiboga Kyankwanzi Kyotera Luweero Lwengo Lyantonde Masaka Mityana Mpigi Mubende Mukono Nakaseke Nakasongola Rakai Ssembabule Wakiso",
  "Eastern": "Amuria Budaka Bududa Bugiri Bugweri Bukedea Bukwo Bulambuli Busia Butaleja Butebo Buyende Iganga Jinja Kaberamaido Kalaki Kaliro Kamuli Kapchorwa Kapelebyong Katakwi Kibuku Kumi Kween Luuka Manafwa Mayuge Mbale Namayingo Namisindwa Namutumba Ngora Pallisa Serere Sironko Soroti Tororo",
  "Northern": "Abim Adjumani Agago Alebtong Amolatar Amudat Amuru Apac Arua Dokolo Gulu Kaabong Karenga Kitgum Koboko Kole Kotido Kwania Lamwo Lira Madi-Okollo Maracha Moroto Moyo Nabilatuk Nakapiripirit Napak Nebbi Nwoya Obongi Omoro Otuke Oyam Pader Pakwach Yumbe Zombo",
  "Western": "Buhweju Buliisa Bundibugyo Bunyangabu Bushenyi Hoima Ibanda Isingiro Kabale Kabarole Kagadi Kakumiro Kamwenge Kanungu Kasese Kazo Kibaale Kikuube Kiruhura Kiryandongo Kisoro Kitagwenda Kyegegwa Kyenjojo Masindi Mbarara Mitooma Ntoroko Ntungamo Rubanda Rubirizi Rukiga Rukungiri Rwampara Sheema",
}
REGION_OF = {d: r for r, ds in REGIONS.items() for d in ds.split()}

ROMAN = re.compile(r"\b(i{1,3}|iv|vi{0,3}|ix|x)\b", re.I)
SMALL = {"of", "and", "the"}

def tidy(name: str) -> str:
    n = re.sub(r"\s+", " ", name.strip())
    if n.isupper() or n.islower():
        n = " ".join(w if w.lower() in SMALL and i else w.capitalize() for i, w in enumerate(n.lower().split(" ")))
    n = ROMAN.sub(lambda m: m.group(0).upper(), n)
    n = re.sub(r"\(\s*", "(", n)
    return n

GENERIC = re.compile(r"^(village|zone|cell|lc ?\d?|block|kitongole)\s*[\dA-Z]{0,4}$|^[A-Z]?\s*\d+[A-Z]?$", re.I)

def main(src: str, out: str):
    load = lambda f: json.load(open(f"{src}/{f}.json"))
    districts = {d["id"]: d["name"] for d in load("districts")}
    counties = {c["id"]: c["district"] for c in load("counties")}
    subs = {s["id"]: (s["name"], counties[s["county"]]) for s in load("sub_counties")}
    parishes = {p["id"]: (p["name"], p["subcounty"]) for p in load("parishes")}
    villages = defaultdict(list)
    for v in load("villages"):
        villages[v["parish"]].append(tidy(v["name"]))

    missing = [n for n in districts.values() if n not in REGION_OF]
    if missing:
        sys.exit(f"No region for: {missing}")

    tree = defaultdict(lambda: defaultdict(lambda: defaultdict(lambda: defaultdict(set))))
    for pid, (pname, sid) in parishes.items():
        sname, did = subs[sid]
        dname = districts[did]
        vs = tree[REGION_OF[dname]][dname][tidy(sname)][tidy(pname)]
        vs.update(v for v in villages.get(pid, []) if not GENERIC.match(v))
    # districts/divisions without parishes still appear
    for sid, (sname, did) in subs.items():
        tree[REGION_OF[districts[did]]][districts[did]][tidy(sname)]

    key = lambda s: s.lower()
    data = [
        [r, [[d, [[s, [[p, sorted(vs, key=key)] for p, vs in sorted(ps.items(), key=lambda x: key(x[0]))]]
                  for s, ps in sorted(ss.items(), key=lambda x: key(x[0]))]]
             for d, ss in sorted(ds.items(), key=lambda x: key(x[0]))]]
        for r, ds in sorted(tree.items())
    ]
    raw = json.dumps(data, separators=(",", ":"), ensure_ascii=False).encode()
    with gzip.open(out, "wb", compresslevel=9) as f:
        f.write(raw)
    n = lambda lvl: sum(1 for _ in walk(data, lvl))
    print(f"regions {len(data)}, districts {n(1)}, divisions {n(2)}, parishes {n(3)}, villages {n(4)}; {len(raw)//1024} KB json, gz written to {out}")

def walk(data, depth, lvl=0):
    for item in data:
        if lvl == depth:
            yield item
        elif isinstance(item, list) and len(item) == 2 and isinstance(item[1], list):
            yield from walk(item[1], depth, lvl + 1)

if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else "packages/delivery/data/uganda-locations.json.gz")
