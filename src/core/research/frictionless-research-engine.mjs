import { assertSafeResearchUrl } from '../security/research-boundary.mjs';

const DEFAULT_USER_AGENT = 'Apex-Frictionless-Research/1.0 (+https://github.com/barrylird777-beep/apex-studio)';
const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_MAX_ARTIFACT_BYTES = 25 * 1024 * 1024;

function clean(value) {
  return value == null ? null : String(value).trim() || null;
}

function normalizeDoi(value) {
  const raw = clean(value);
  if (!raw) return null;
  return raw.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '').replace(/^doi:/i, '').trim().toLowerCase();
}

function normalizeTitle(value) {
  return clean(value)?.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim() || '';
}

function absUrl(value, base) {
  try { return value ? new URL(value, base).toString() : null; } catch { return null; }
}

async function fetchJson(fetchImpl, url, options = {}) {
  const response = await fetchImpl(url, {
    ...options,
    headers: {
      accept: 'application/json',
      'user-agent': options.userAgent || DEFAULT_USER_AGENT,
      ...(options.headers || {})
    }
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return response.json();
}

async function fetchText(fetchImpl, url, options = {}) {
  const response = await fetchImpl(url, {
    ...options,
    headers: {
      accept: 'text/plain,text/html,application/pdf,*/*',
      'user-agent': options.userAgent || DEFAULT_USER_AGENT,
      ...(options.headers || {})
    }
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  const contentLength = Number(response.headers.get?.('content-length') || 0);
  if (contentLength > (options.maxBytes || DEFAULT_MAX_ARTIFACT_BYTES)) {
    throw new Error('artifact exceeds configured size limit');
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > (options.maxBytes || DEFAULT_MAX_ARTIFACT_BYTES)) {
    throw new Error('artifact exceeds configured size limit');
  }
  return {
    url,
    contentType: response.headers.get?.('content-type') || 'application/octet-stream',
    bytes,
    text: (() => {
      try { return new TextDecoder().decode(bytes); } catch { return ''; }
    })()
  };
}

function uninvertAbstract(index) {
  if (!index || typeof index !== 'object') return null;
  const tokens = [];
  for (const [word, positions] of Object.entries(index)) {
    for (const position of Array.isArray(positions) ? positions : []) tokens[position] = word;
  }
  return tokens.filter(Boolean).join(' ') || null;
}

function normalizeArtifact(raw, source) {
  if (!raw?.url) return null;
  return {
    url: String(raw.url),
    type: raw.type || 'unknown',
    version: raw.version || null,
    license: raw.license || null,
    access: raw.access || 'open',
    source,
    isPdf: Boolean(raw.isPdf || /\.pdf(?:$|[?#])/i.test(raw.url))
  };
}

function identityFor(work) {
  const doi = normalizeDoi(work?.doi || work?.identifiers?.doi);
  if (doi) return `doi:${doi}`;
  const pmid = clean(work?.identifiers?.pmid);
  if (pmid) return `pmid:${pmid}`;
  const arxiv = clean(work?.identifiers?.arxiv);
  if (arxiv) return `arxiv:${arxiv}`;
  return `title:${normalizeTitle(work?.title)}`;
}

function mergeArtifacts(...lists) {
  const seen = new Set();
  const result = [];
  for (const list of lists) {
    for (const item of list || []) {
      const artifact = normalizeArtifact(item, item.source || 'resolver');
      if (!artifact) continue;
      const key = artifact.url.toLowerCase().replace(/#.*$/, '');
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(artifact);
    }
  }
  return result;
}

function scoreCandidate(candidate, query) {
  const q = normalizeTitle(query);
  const t = normalizeTitle(candidate.title);
  if (!q || !t) return 0;
  const qa = new Set(q.split(' '));
  const ta = new Set(t.split(' '));
  let common = 0;
  for (const token of qa) if (ta.has(token)) common++;
  return common / Math.max(qa.size, 1);
}

function parseRssItems(xml, baseUrl) {
  const items = [];
  const blocks = xml.match(/<(?:item|entry)\b[\s\S]*?<\/(?:item|entry)>/gi) || [];
  for (const block of blocks) {
    const title = block.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/<[^>]+>/g, '').trim() || null;
    const linkMatch = block.match(/<link[^>]*(?:href=["']([^"']+)["'][^>]*)?(?:\/?>)(?:\s*<\/link>)?/i);
    const link = linkMatch?.[1] || block.match(/<link[^>]*>\s*([^<]+)\s*<\/link>/i)?.[1]?.trim() || null;
    const guid = block.match(/<guid[^>]*>([\s\S]*?)<\/guid>/i)?.[1]?.trim() || null;
    const description = block.match(/<(?:description|summary|content)[^>]*>([\s\S]*?)<\/(?:description|summary|content)>/i)?.[1]?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() || null;
    items.push({
      title,
      url: absUrl(link || guid, baseUrl),
      summary: description,
      publishedAt: block.match(/<(?:pubDate|published|updated)[^>]*>([\s\S]*?)<\//i)?.[1]?.trim() || null
    });
  }
  return items.filter(item => item.title || item.url);
}

export class FrictionlessResearchEngine {
  constructor(options = {}) {
    this.fetch = options.fetch || globalThis.fetch;
    if (typeof this.fetch !== 'function') throw new TypeError('fetch implementation is required');
    this.userAgent = options.userAgent || DEFAULT_USER_AGENT;
    this.email = options.email || process.env.OPENALEX_MAILTO || null;
    this.unpaywallEmail = options.unpaywallEmail || process.env.UNPAYWALL_EMAIL || this.email;
    this.semanticScholarApiKey = options.semanticScholarApiKey || process.env.SEMANTIC_SCHOLAR_API_KEY || null;
    this.timeoutMs = Number(options.timeoutMs || DEFAULT_TIMEOUT_MS);
    this.maxArtifactBytes = Number(options.maxArtifactBytes || DEFAULT_MAX_ARTIFACT_BYTES);
    this.localSynthesizer = options.localSynthesizer || null;
  }

  async requestJson(url, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs || this.timeoutMs);
    try {
      return await fetchJson(this.fetch, url, {
        ...options,
        signal: controller.signal,
        userAgent: this.userAgent,
        headers: this.semanticScholarApiKey && /semanticscholar/i.test(url)
          ? { 'x-api-key': this.semanticScholarApiKey, ...(options.headers || {}) }
          : options.headers
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  async resolveOpenAlex(query) {
    const url = new URL('https://api.openalex.org/works');
    url.searchParams.set('search', query);
    url.searchParams.set('per-page', '5');
    if (this.email) url.searchParams.set('mailto', this.email);
    const data = await this.requestJson(url.toString());
    const results = Array.isArray(data.results) ? data.results : [];
    const primary = results.sort((a, b) => scoreCandidate(b, query) - scoreCandidate(a, query))[0];
    if (!primary) return null;

    const artifacts = [];
    for (const location of [
      primary.best_oa_location,
      primary.primary_location,
      ...(Array.isArray(primary.locations) ? primary.locations : [])
    ]) {
      if (location?.pdf_url) artifacts.push({
        url: location.pdf_url,
        type: location.is_oa ? 'open-access-pdf' : 'repository-pdf',
        version: location.version || null,
        license: location.license || null,
        access: location.is_oa ? 'open' : 'listed',
        isPdf: true,
        source: 'openalex'
      });
      if (location?.landing_page_url && location.is_oa) artifacts.push({
        url: location.landing_page_url,
        type: 'open-access-landing-page',
        version: location.version || null,
        license: location.license || null,
        access: 'open',
        source: 'openalex'
      });
    }

    return {
      resolver: 'openalex',
      identity: `openalex:${primary.id}`,
      title: primary.title,
      doi: normalizeDoi(primary.doi),
      publicationDate: primary.publication_date || null,
      isOpenAccess: Boolean(primary.open_access?.is_oa),
      abstract: uninvertAbstract(primary.abstract_inverted_index),
      citationsCount: Number(primary.cited_by_count || 0),
      concepts: (primary.concepts || []).map(c => ({ name: c.display_name, score: c.score })),
      identifiers: {
        openalex: primary.id,
        doi: normalizeDoi(primary.doi),
        pmid: primary.ids?.pmid ? String(primary.ids.pmid).replace(/^https?:\/\/pubmed\.ncbi\.nlm\.nih\.gov\//, '').replace(/\/$/, '') : null,
        arxiv: primary.ids?.arxiv ? String(primary.ids.arxiv).split('/').pop() : null
      },
      artifacts: mergeArtifacts(artifacts)
    };
  }

  async resolveCrossref(queryOrDoi) {
    const doi = normalizeDoi(queryOrDoi);
    const url = doi
      ? `https://api.crossref.org/works/${encodeURIComponent(doi)}`
      : `https://api.crossref.org/works?query.bibliographic=${encodeURIComponent(queryOrDoi)}&rows=5`;
    const data = await this.requestJson(url);
    const work = data.message?.items ? data.message.items.sort((a, b) => scoreCandidate(b, queryOrDoi) - scoreCandidate(a, queryOrDoi))[0] : data.message;
    if (!work) return null;
    return {
      resolver: 'crossref',
      identity: `crossref:${work.DOI || normalizeDoi(queryOrDoi) || normalizeTitle(work.title?.[0])}`,
      title: work.title?.[0] || null,
      doi: normalizeDoi(work.DOI),
      publicationDate: work.published?.['date-parts']?.[0]?.join('-') || null,
      abstract: work.abstract ? work.abstract.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : null,
      authors: (work.author || []).map(a => ({ given: a.given || null, family: a.family || null, orcid: a.ORCID || null })),
      references: (work.reference || []).map(r => ({
        doi: normalizeDoi(r.DOI),
        title: r['article-title'] || r.unstructured || null
      })),
      identifiers: { doi: normalizeDoi(work.DOI) },
      artifacts: []
    };
  }

  async resolveSemanticScholar(queryOrId) {
    const id = clean(queryOrId);
    const fields = 'title,abstract,year,authors,externalIds,isOpenAccess,openAccessPdf,citations,references';
    const encoded = encodeURIComponent(id);
    const url = id && (/^10\./.test(id) || /^[0-9a-f]{40}$/i.test(id) || /^ARXIV:/i.test(id))
      ? `https://api.semanticscholar.org/graph/v1/paper/${encoded}?fields=${fields}`
      : `https://api.semanticscholar.org/graph/v1/paper/search/match?query=${encoded}&fields=${fields}`;
    const data = await this.requestJson(url);
    const paper = data.data?.[0] || data;
    if (!paper?.title) return null;
    return {
      resolver: 'semantic-scholar',
      identity: `s2:${paper.paperId}`,
      title: paper.title,
      doi: normalizeDoi(paper.externalIds?.DOI),
      publicationDate: paper.year ? String(paper.year) : null,
      abstract: paper.abstract || null,
      authors: (paper.authors || []).map(a => ({ id: a.authorId, name: a.name })),
      identifiers: {
        semanticScholar: paper.paperId,
        doi: normalizeDoi(paper.externalIds?.DOI),
        arxiv: paper.externalIds?.ArXiv || null,
        pmid: paper.externalIds?.PubMed || null
      },
      citations: (paper.citations || []).map(c => ({ id: c.paperId, title: c.title || null, abstract: c.abstract || null })),
      references: (paper.references || []).map(r => ({ id: r.paperId, title: r.title || null, abstract: r.abstract || null })),
      artifacts: paper.openAccessPdf?.url ? [{
        url: paper.openAccessPdf.url,
        type: 'open-access-pdf',
        access: 'open',
        isPdf: true,
        source: 'semantic-scholar'
      }] : []
    };
  }

  async resolveUnpaywall(doi) {
    const normalized = normalizeDoi(doi);
    if (!normalized || !this.unpaywallEmail) return null;
    const url = `https://api.unpaywall.org/v2/${encodeURIComponent(normalized)}?email=${encodeURIComponent(this.unpaywallEmail)}`;
    const data = await this.requestJson(url);
    const locations = Array.isArray(data.locations) ? data.locations : [];
    return {
      resolver: 'unpaywall',
      identity: `unpaywall:${normalized}`,
      title: data.title || null,
      doi: normalized,
      isOpenAccess: Boolean(data.is_oa),
      identifiers: { doi: normalized },
      artifacts: locations.map(location => ({
        url: location.url_for_pdf || location.url,
        type: location.url_for_pdf ? 'open-access-pdf' : 'open-access-landing-page',
        version: location.version || null,
        license: location.license || null,
        access: 'open',
        isPdf: Boolean(location.url_for_pdf),
        source: 'unpaywall'
      })).filter(x => x.url)
    };
  }

  mergeWorks(records, query) {
    const valid = records.filter(Boolean);
    const byIdentity = new Map();
    for (const record of valid) {
      const key = identityFor(record);
      const existing = byIdentity.get(key);
      if (!existing) {
        byIdentity.set(key, structuredClone(record));
        continue;
      }
      existing.artifacts = mergeArtifacts(existing.artifacts, record.artifacts);
      existing.references = [...(existing.references || []), ...(record.references || [])];
      existing.citations = [...(existing.citations || []), ...(record.citations || [])];
      existing.authors = existing.authors || record.authors;
      existing.abstract = existing.abstract || record.abstract;
      existing.doi = existing.doi || record.doi;
    }
    const merged = [...byIdentity.values()];
    merged.sort((a, b) => {
      const openDelta = Number(Boolean(b.isOpenAccess)) - Number(Boolean(a.isOpenAccess));
      if (openDelta) return openDelta;
      return (b.citationsCount || 0) - (a.citationsCount || 0);
    });
    return merged[0] || {
      title: query,
      identity: `query:${normalizeTitle(query)}`,
      artifacts: []
    };
  }

  async resolveWork(queryOrIdentifier) {
    const query = clean(queryOrIdentifier);
    if (!query) throw new TypeError('research query or identifier is required');

    const [openAlex, crossref, semanticScholar] = await Promise.allSettled([
      this.resolveOpenAlex(query),
      this.resolveCrossref(query),
      this.resolveSemanticScholar(query)
    ]);

    const records = [
      openAlex.status === 'fulfilled' ? openAlex.value : null,
      crossref.status === 'fulfilled' ? crossref.value : null,
      semanticScholar.status === 'fulfilled' ? semanticScholar.value : null
    ];

    const base = this.mergeWorks(records, query);
    const unpaywall = await this.resolveUnpaywall(base.doi).catch(() => null);
    const merged = this.mergeWorks([base, unpaywall], query);
    return {
      ...merged,
      identity: identityFor(merged),
      query,
      resolvers: records.filter(Boolean).map(r => r.resolver),
      artifacts: mergeArtifacts(...records.filter(Boolean).map(r => r.artifacts), unpaywall?.artifacts),
      provenance: {
        retrievedAt: new Date().toISOString(),
        resolverRecords: records.filter(Boolean).map(r => r.identity)
      }
    };
  }

  async expandEvidence(work, options = {}) {
    const maxReferences = Math.max(1, Number(options.maxReferences || 20));
    const references = [...(work.references || [])].filter(Boolean).slice(0, maxReferences);
    const evidence = [];

    for (const reference of references) {
      const query = reference.doi || reference.id || reference.title;
      if (!query) continue;
      try {
        evidence.push(await this.resolveWork(query));
      } catch (error) {
        evidence.push({
          query,
          status: 'unresolved',
          error: String(error.message || error)
        });
      }
    }

    return evidence;
  }

  buildEvidenceGraph(work, evidence = []) {
    const nodes = new Map();
    const edges = [];
    const addNode = (node) => {
      if (!node?.id) return;
      if (!nodes.has(node.id)) nodes.set(node.id, node);
    };

    const rootId = identityFor(work);
    addNode({
      id: rootId,
      type: 'work',
      title: work.title,
      evidenceState: work.artifacts?.length ? 'direct-or-open' : 'metadata-only'
    });

    for (const item of evidence) {
      const id = identityFor(item);
      addNode({
        id,
        type: 'work',
        title: item.title,
        evidenceState: item.artifacts?.length ? 'direct-or-open' : 'metadata-only'
      });
      edges.push({ from: rootId, to: id, relation: 'reference-or-neighborhood' });
      for (const artifact of item.artifacts || []) {
        const artifactId = `artifact:${artifact.url}`;
        addNode({ id: artifactId, type: 'artifact', url: artifact.url, access: artifact.access });
        edges.push({ from: id, to: artifactId, relation: 'has-artifact' });
      }
    }

    for (const artifact of work.artifacts || []) {
      const artifactId = `artifact:${artifact.url}`;
      addNode({ id: artifactId, type: 'artifact', url: artifact.url, access: artifact.access });
      edges.push({ from: rootId, to: artifactId, relation: 'has-artifact' });
    }

    return { nodes: [...nodes.values()], edges };
  }

  buildEvidenceFrontier(work, evidence = []) {
    const direct = work.artifacts?.length > 0;
    const supporting = evidence.filter(item => item.artifacts?.length || item.abstract);
    return {
      question: work.query || work.title,
      directEvidence: direct ? [identityFor(work)] : [],
      supportingEvidence: supporting.map(identityFor),
      contradictoryEvidence: [],
      missingEvidence: direct ? [] : ['full-text source for target work'],
      derivedConclusions: [],
      confidence: direct ? 'source-available' : supporting.length >= 2 ? 'reconstructed-candidate' : 'metadata-only'
    };
  }

  async reconstruct(work, evidence = [], options = {}) {
    const frontier = this.buildEvidenceFrontier(work, evidence);
    const bundle = {
      mode: work.artifacts?.length ? 'direct-plus-evidence' : 'evidence-reconstruction',
      target: {
        identity: identityFor(work),
        title: work.title,
        doi: work.doi || null
      },
      evidence: evidence.map(item => ({
        identity: identityFor(item),
        title: item.title,
        abstract: item.abstract || null,
        artifacts: item.artifacts || [],
        citationsCount: item.citationsCount || 0
      })),
      frontier,
      provenance: {
        generatedAt: new Date().toISOString(),
        method: 'open-index-and-citation-neighborhood',
        inaccessibleSourceClaimedAsRead: false
      }
    };

    if (typeof options.synthesize === 'function') {
      bundle.synthesis = await options.synthesize(bundle);
      bundle.provenance.synthesisProvider = 'caller-supplied';
    } else if (typeof this.localSynthesizer === 'function') {
      bundle.synthesis = await this.localSynthesizer(bundle);
      bundle.provenance.synthesisProvider = 'local-synthesizer';
    }

    return bundle;
  }

  async ingestSyndication(url) {
    const safeUrl = await assertSafeResearchUrl(url);
    const result = await fetchText(this.fetch, safeUrl, {
      userAgent: this.userAgent,
      maxBytes: this.maxArtifactBytes
    });
    return {
      source: safeUrl,
      retrievedAt: new Date().toISOString(),
      items: parseRssItems(result.text, url)
    };
  }

  async fetchOpenArtifact(artifact) {
    if (!artifact?.url || artifact.access !== 'open') {
      throw new Error('artifact is not marked open');
    }
    const safeUrl = await assertSafeResearchUrl(artifact.url);
    return fetchText(this.fetch, safeUrl, {
      userAgent: this.userAgent,
      maxBytes: this.maxArtifactBytes
    });
  }
}

export {
  identityFor,
  normalizeDoi,
  normalizeTitle,
  mergeArtifacts,
  uninvertAbstract,
  parseRssItems
};
