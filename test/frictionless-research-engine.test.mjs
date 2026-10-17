import test from 'node:test';
import assert from 'node:assert/strict';
import { assertSafeResearchUrl } from '../src/core/security/research-boundary.mjs';
import {
  FrictionlessResearchEngine,
  identityFor,
  normalizeDoi,
  normalizeTitle,
  uninvertAbstract,
  parseRssItems
} from '../src/core/research/frictionless-research-engine.mjs';

function response(body, { status = 200, contentType = 'application/json' } = {}) {
  const bytes = new TextEncoder().encode(typeof body === 'string' ? body : JSON.stringify(body));
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        if (name.toLowerCase() === 'content-type') return contentType;
        if (name.toLowerCase() === 'content-length') return String(bytes.byteLength);
        return null;
      }
    },
    async json() { return typeof body === 'string' ? JSON.parse(body) : body; },
    async arrayBuffer() { return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); }
  };
}

test('normalizes identifiers and inverted abstracts', () => {
  assert.equal(normalizeDoi('https://doi.org/10.1234/ABC.X'), '10.1234/abc.x');
  assert.equal(normalizeTitle('Hello, Research! 2026'), 'hello research 2026');
  assert.equal(uninvertAbstract({ Hello: [0], world: [1], again: [2] }), 'Hello world again');
  assert.equal(identityFor({ doi: '10.1234/ABC.X' }), 'doi:10.1234/abc.x');
});

test('resolves a work through multiple open metadata/index layers', async () => {
  const calls = [];
  const fakeFetch = async (url) => {
    calls.push(url);
    const u = new URL(url);

    if (u.hostname === 'api.openalex.org') {
      return response({
        results: [{
          id: 'https://openalex.org/W123',
          title: 'Open Research Systems',
          doi: 'https://doi.org/10.1234/ABC',
          publication_date: '2026-01-01',
          cited_by_count: 42,
          open_access: { is_oa: true, oa_url: 'https://repo.example/paper.pdf' },
          best_oa_location: {
            pdf_url: 'https://repo.example/paper.pdf',
            is_oa: true,
            version: 'acceptedVersion',
            license: 'cc-by'
          },
          abstract_inverted_index: { Open: [0], research: [1], systems: [2] },
          concepts: [{ display_name: 'Computer Science', score: 0.9 }]
        }]
      });
    }

    if (u.hostname === 'api.crossref.org') {
      return response({
        message: {
          title: ['Open Research Systems'],
          DOI: '10.1234/ABC',
          abstract: '<jats:p>Independent abstract.</jats:p>',
          reference: [{ DOI: '10.1111/foundation' }]
        }
      });
    }

    if (u.hostname === 'api.semanticscholar.org') {
      return response({
        data: [{
          paperId: 's2-123',
          title: 'Open Research Systems',
          abstract: 'Semantic abstract.',
          year: 2026,
          externalIds: { DOI: '10.1234/ABC' },
          isOpenAccess: true,
          openAccessPdf: { url: 'https://repo.example/paper.pdf' },
          references: [{ paperId: 's2-foundation', title: 'Foundation' }]
        }]
      });
    }

    if (u.hostname === 'api.unpaywall.org') {
      return response({
        is_oa: true,
        title: 'Open Research Systems',
        doi: '10.1234/ABC',
        locations: [{
          url_for_pdf: 'https://repo.example/paper.pdf',
          version: 'publishedVersion',
          license: 'cc-by'
        }]
      });
    }

    throw new Error('unexpected URL: ' + url);
  };

  const engine = new FrictionlessResearchEngine({
    fetch: fakeFetch,
    email: 'test@example.org'
  });

  const work = await engine.resolveWork('Open Research Systems');
  assert.equal(work.identity, 'doi:10.1234/abc');
  assert.equal(work.isOpenAccess, true);
  assert.match(work.abstract, /Open research systems/);
  assert.equal(work.artifacts.length, 1);
  assert.equal(work.artifacts[0].url, 'https://repo.example/paper.pdf');
  assert.ok(calls.some(url => url.includes('openalex')));
  assert.ok(calls.some(url => url.includes('crossref')));
  assert.ok(calls.some(url => url.includes('semanticscholar')));
  assert.ok(calls.some(url => url.includes('unpaywall')));
});

test('builds an evidence frontier and never claims an inaccessible target was read', async () => {
  const engine = new FrictionlessResearchEngine({
    fetch: async () => response({ results: [] })
  });

  const work = {
    title: 'Restricted Target',
    doi: '10.1234/restricted',
    artifacts: [],
    query: 'Restricted Target'
  };
  const evidence = [{
    title: 'Open Foundation',
    doi: '10.1234/open',
    abstract: 'Accessible foundation.',
    artifacts: [{
      url: 'https://repo.example/open.pdf',
      type: 'open-access-pdf',
      access: 'open',
      isPdf: true
    }]
  }, {
    title: 'Independent Supporting Work',
    doi: '10.1234/supporting',
    abstract: 'Independent supporting evidence.',
    artifacts: [{
      url: 'https://repo.example/supporting.pdf',
      type: 'open-access-pdf',
      access: 'open',
      isPdf: true
    }]
  }];

  const bundle = await engine.reconstruct(work, evidence);
  assert.equal(bundle.mode, 'evidence-reconstruction');
  assert.equal(bundle.provenance.inaccessibleSourceClaimedAsRead, false);
  assert.equal(bundle.frontier.confidence, 'reconstructed-candidate');
});

test('parses RSS/Atom-style syndication records', () => {
  const xml = `<rss><channel>
    <item><title>Research release</title><link>https://example.org/a</link><description>Summary</description><pubDate>Wed, 07 Oct 2026 12:00:00 GMT</pubDate></item>
  </channel></rss>`;
  const items = parseRssItems(xml, 'https://example.org/feed.xml');
  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'Research release');
  assert.equal(items[0].url, 'https://example.org/a');
});

test('syndication fetch validates redirect destinations before following them', async () => {
  const calls = [];
  const engine = new FrictionlessResearchEngine({
    validateUrl: async raw => {
      const url = new URL(raw);
      if (url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname.endsWith('.localhost')) {
        throw new Error('research URL targets a private or loopback address');
      }
      return url.toString();
    },
    fetch: async (url, options) => {
      calls.push({ url, redirect: options.redirect });
      return {
        ok: false,
        status: 302,
        headers: { get(name) { return name.toLowerCase() === 'location' ? 'http://127.0.0.1/private' : null; } }
      };
    }
  });

  await assert.rejects(
    engine.ingestSyndication('https://feeds.example.test/updates.xml'),
    /private or loopback/
  );
  assert.equal(calls.length, 1, 'must reject the private redirect before a second fetch');
  assert.equal(calls[0].redirect, 'manual', 'fetch must not follow redirects automatically');
});


test('research URL boundary rejects loopback, unspecified, mapped, link-local and reserved IPs', async () => {
  for (const url of [
    'http://0.0.0.0/private',
    'http://127.0.0.1/private',
    'http://192.0.2.1/documentation',
    'http://[::]/private',
    'http://[::ffff:127.0.0.1]/private',
    'http://[fe80::1]/private',
    'http://[fc00::1]/private',
    'http://[2001:1::1]/special-purpose',
    'http://[2002:7f00:1::]/6to4-loopback',
    'http://[64:ff9b::7f00:1]/nat64-loopback',
    'http://[3fff::1]/documentation'
  ]) {
    await assert.rejects(assertSafeResearchUrl(url), /private|loopback|reserved|link-local/i, url);
  }
});


test('research URL boundary rejects non-global and special-purpose IPv6 ranges', async () => {
  for (const url of [
    'http://[ff02::1]/multicast',
    'http://[fec0::1]/deprecated-site-local',
    'http://[2001:1::1]/special-purpose',
    'http://[2002:0808:0808::1]/6to4'
  ]) {
    await assert.rejects(assertSafeResearchUrl(url), /private|loopback|reserved|link-local/i, url);
  }
});


test('research URL boundary blocks localhost with a trailing dot', async () => {
  await assert.rejects(
    assertSafeResearchUrl('http://localhost./private'),
    /blocked hostname|private|loopback/i
  );
});
