import type {Decorator} from '@storybook/react';
import {setProjectAnnotations} from '@storybook/react-vite';
import {MotionConfig} from 'framer-motion';
import {createElement} from 'react';
import * as projectAnnotations from './preview.js';

const withReducedMotion: Decorator = (Story) =>
  createElement(MotionConfig, {reducedMotion: 'always'}, createElement(Story));

setProjectAnnotations([projectAnnotations, {decorators: [withReducedMotion]}]);
