import {embeddedSkillResources} from './generated/assets.js';

export interface SkillResource {
  uri: string;
  name: string;
  title: string;
  description: string;
  revision?: number;
  catalogCategory?: string;
  catalogPrompt?: string;
  mimeType: string;
  size: number;
  sha256: string;
  text: string;
}

const shippedSkillResources = new Map(
  embeddedSkillResources.map((resource) => [resource.uri, resource]),
);

export function listShippedSkillResources(): readonly SkillResource[] {
  return embeddedSkillResources;
}

export function getShippedSkillResource(uri: string): SkillResource | undefined {
  return shippedSkillResources.get(uri);
}
