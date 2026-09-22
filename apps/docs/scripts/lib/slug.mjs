import GithubSlugger, {slug} from 'github-slugger';

// Fumadocs honors a trailing `[#id]` on a heading as an explicit anchor. The
// checks must resolve the same id, or every path-keyed reference heading
// would look like a missing anchor.
const customIdPattern = /\s*\[#(?<id>[^\]]+?)\]\s*$/;

export {GithubSlugger, slug as slugForHeading};

export function anchorForHeading(heading, slugger) {
  const match = customIdPattern.exec(heading);
  if (match?.groups?.id) return match.groups.id;
  return slugger.slug(headingText(heading));
}

export function headingText(heading) {
  return heading
    .replace(customIdPattern, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/(^|[^\p{Letter}\p{Number}])__([\s\S]+?)__($|[^\p{Letter}\p{Number}])/gu, '$1$2$3')
    .replace(/(^|[^\p{Letter}\p{Number}])_([\s\S]+?)_($|[^\p{Letter}\p{Number}])/gu, '$1$2$3')
    .replace(/[`*~]/g, '');
}
