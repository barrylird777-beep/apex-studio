# Bible Library

Apex includes a dedicated Bible Library designed for production use: source lookup, Scripture provenance, cross-version comparison, canon metadata, and local full-text corpora.

## Local corpus

The repository currently catalogs 33 openly redistributable editions across 22 languages from the open `midvash/bible-data` corpus. The upstream project publishes each edition as whole-Bible JSON, per-book JSON, and SQLite, with license metadata. citeturn0search0turn0search1

Install the complete local corpus:

```bash
npm run bible:import:all
```

Or install selected editions:

```bash
npm run bible:import -- kjv web asv
```

The downloaded text is intentionally kept out of Git history because a full multi-version corpus is large. The importer makes a fresh, reproducible local copy instead.

## Included catalog

The catalog covers the currently verified open corpus: KJV, ASV, WEB, Geneva 1599, Douay-Rheims, German, French, Italian, Portuguese, Russian, Ukrainian, Polish, Czech, Hungarian, Romanian, Scandinavian, Dutch, Chinese, Arabic, Vietnamese, Hebrew source texts, Greek Textus Receptus, and Latin Vulgate/Clementine Vulgate. citeturn0search2turn0search6

## Canons

Apex tracks canon families separately from translations because "the Bible" does not have one universally identical table of contents. The catalog currently distinguishes Protestant 66-book, Catholic, Eastern Orthodox, and Ethiopian Orthodox traditions; the latter traditions can have books/counts that vary by ecclesial tradition.

## Copyright boundary

Apex does **not** copy modern copyrighted translations into the repository merely because they are available online. The open corpus itself explicitly excludes active-copyright translations and points users toward licensed APIs/publishers for those editions. citeturn0search2

For example, a provider adapter can retrieve a licensed modern translation at generation time without storing the full text in Git.

## Production use

Every Bible-derived story event and visual prompt should retain:

- edition/version
- book
- chapter
- verse or range
- source locator
- whether the resulting scene is direct, paraphrased, inferred, dramatized, or fictional

That provenance is carried forward into storyboard and visual-generation data.
