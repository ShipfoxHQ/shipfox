import {normalizeRoutePath} from '#compose/normalize-route-path.js';
import type {ClientFeature, NavTabEntry, SettingsSectionEntry} from '#contract.js';

interface Ordered<T> {
  entry: T;
  featureIndex: number;
  declarationIndex: number;
}

function byOrder<T extends {order?: number}>(left: Ordered<T>, right: Ordered<T>): number {
  return (
    (left.entry.order ?? 500) - (right.entry.order ?? 500) ||
    left.featureIndex - right.featureIndex ||
    left.declarationIndex - right.declarationIndex
  );
}

export function navigationEntries(features: readonly ClientFeature[]): NavTabEntry[] {
  return features
    .flatMap((feature, featureIndex) =>
      (feature.navigation ?? []).map((entry, declarationIndex) => ({
        entry,
        featureIndex,
        declarationIndex,
      })),
    )
    .sort(byOrder)
    .map(({entry}) => ({...entry, to: normalizeRoutePath(entry.to)}));
}

export function settingsEntries(features: readonly ClientFeature[]): SettingsSectionEntry[] {
  return features
    .flatMap((feature, featureIndex) =>
      (feature.settingsSections ?? []).map((entry, declarationIndex) => ({
        entry,
        featureIndex,
        declarationIndex,
      })),
    )
    .sort(byOrder)
    .map(({entry}) => entry);
}
