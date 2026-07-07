import {docs} from 'collections/server';
import {loader} from 'fumadocs-core/source';
import {icons} from 'lucide-react';
import {createElement} from 'react';
import {siBazel, siGithub, siGradle, siNixos, siNx, siTurborepo} from 'simple-icons';

const simpleIcons = {
  github: siGithub,
  turborepo: siTurborepo,
  nx: siNx,
  gradle: siGradle,
  bazel: siBazel,
  nixos: siNixos,
};

// See https://fumadocs.vercel.app/docs/headless/source-api for more info
export const source = loader({
  // it assigns a URL to your pages
  baseUrl: '/',
  source: docs.toFumadocsSource(),
  icon(icon) {
    if (!icon) return;
    if (icon in icons) return createElement(icons[icon as keyof typeof icons]);
    if (icon.startsWith('si:')) {
      const key = icon.slice(3) as keyof typeof simpleIcons;
      const si = simpleIcons[key];
      if (si)
        return createElement(
          'svg',
          {
            key: icon,
            role: 'img',
            viewBox: '0 0 24 24',
            fill: 'currentColor',
            width: '1em',
            height: '1em',
          },
          createElement('path', {d: si.path}),
        );
    }
  },
});
