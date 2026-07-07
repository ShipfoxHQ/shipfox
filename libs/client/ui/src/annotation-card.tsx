import type {AnnotationStyleDto} from '@shipfox/annotations-dto';
import {Callout, CalloutContent} from '@shipfox/react-ui/callout';
import {Markdown} from '@shipfox/react-ui/markdown';
import {memo} from 'react';

type AnnotationCardProps = {
  style: AnnotationStyleDto;
  body: string;
};

const AnnotationCard = memo(function AnnotationCard({style, body}: AnnotationCardProps) {
  if (!body.trim()) return null;

  return (
    <Callout type={style}>
      <CalloutContent>
        <Markdown>{body}</Markdown>
      </CalloutContent>
    </Callout>
  );
});

export {AnnotationCard, type AnnotationCardProps};
