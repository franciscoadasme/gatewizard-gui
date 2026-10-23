import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { DOCS_LINKS } from './docsLinks.js'

const docsRoot = path.resolve(import.meta.dirname, '../../../../../gatewizard/docs')

/**
 * Python-Markdown / MkDocs default slug.
 * @param {string} heading
 */
function mkdocsSlug(heading) {
  const ascii = heading.normalize('NFKD').replace(/[^\x00-\x7F]/g, '')
  const cleaned = ascii.replace(/[^\w\s-]/g, '').trim().toLowerCase()
  return cleaned.replace(/[-\s]+/g, '-')
}

/**
 * @param {string} markdown
 * @returns {Set<string>}
 */
function headingSlugs(markdown) {
  const slugs = new Set()
  for (const line of markdown.split(/\r?\n/)) {
    const match = /^(#{1,6})\s+(.+?)\s*$/.exec(line)
    if (!match) continue
    slugs.add(mkdocsSlug(match[2]))
  }
  return slugs
}

test('documentation buttons point at headings in the user guide and the API', () => {
  const guide = fs.readFileSync(path.join(docsRoot, 'user-guide.md'), 'utf8')
  const guideSlugs = headingSlugs(guide)
  /** @type {Map<string, Set<string>>} */
  const apiSlugs = new Map()

  for (const [id, entry] of Object.entries(DOCS_LINKS)) {
    assert.ok(
      guideSlugs.has(entry.guide),
      `${id} points at #${entry.guide}, which is not a user-guide heading`
    )
    for (const api of entry.api) {
      const hash = api.path.indexOf('#')
      assert.ok(hash > 0, `${id} API link ${api.label} has no fragment`)
      const file = `${api.path.slice(0, hash).replace(/\/$/, '')}.md`
      const fragment = api.path.slice(hash + 1)
      let slugs = apiSlugs.get(file)
      if (!slugs) {
        const markdown = fs.readFileSync(path.join(docsRoot, file), 'utf8')
        slugs = headingSlugs(markdown)
        apiSlugs.set(file, slugs)
      }
      assert.ok(slugs.has(fragment), `${id} points at ${file}#${fragment}, which is not a heading`)
    }
  }
})
