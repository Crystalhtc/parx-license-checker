import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeInstitution, resolveInstitutionConfig } from './institutionConfig.ts';
import { parseCpssoProfilePage, resolveCpssoSearchUrl } from './cpsbcAdapter.ts';

test('defaults to CPSBC when no institution is provided', () => {
  assert.equal(normalizeInstitution(), 'cpsbc');
});

test('resolves the Ontario CPSO registration site', () => {
  const config = resolveInstitutionConfig('cpso');
  assert.equal(config.label, 'CPSO');
  assert.equal(config.baseUrl, 'https://register.cpso.on.ca/');
  assert.equal(config.searchInputSelector, '#searchForm input[name="cpsoNumber"], #searchForm #cpsoId');
  assert.equal(config.searchPlaceholder, 'CPSO #');
});

test('resolves a direct CPSO physician profile URL for numeric searches', () => {
  assert.equal(resolveCpssoSearchUrl('65214'), 'https://register.cpso.on.ca/physician-info/?cpsonum=65214');
  assert.equal(resolveCpssoSearchUrl('Kwan'), 'https://register.cpso.on.ca/');
});

test('parses a direct CPSO physician profile page', () => {
  const result = parseCpssoProfilePage({
    fullName: 'Kwan, Irene Ka Wai',
    bodyText: 'CPSO#: 65214 Member Status: ACTIVE as of 15 Jun 1992 Current CPSO registration class: Independent Practice as of 15 Jun 1993',
    profileUrl: 'https://register.cpso.on.ca/physician-info/?cpsonum=65214',
  });

  assert.equal(result.fullName, 'Kwan, Irene Ka Wai');
  assert.equal(result.licenceStatus, 'ACTIVE');
  assert.equal(result.licenceClass, 'Independent Practice');
  assert.equal(result.cpsoNumber, '65214');
  assert.equal(result.practiceType, undefined);
});
