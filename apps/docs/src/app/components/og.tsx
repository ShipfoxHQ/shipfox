import type {ImageResponseOptions} from 'next/dist/compiled/@vercel/og/types';
import {ImageResponse} from 'next/og';

interface GenerateProps {
  title: string;
  description?: string;
}

export function generateOGImage(options: GenerateProps & ImageResponseOptions): ImageResponse {
  const {title, description, ...rest} = options;

  return new ImageResponse(generate({title, description}), {
    width: 1200,
    height: 630,
    ...rest,
  });
}

export function generate(props: GenerateProps) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        padding: '4rem',
        backgroundColor: '#FFFFFF',
        backgroundImage: 'linear-gradient(to top right, #FFFFFF, #C8C8C8)',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          gap: '16px',
          marginBottom: '12px',
        }}
      >
        <picture>
          <img
            src="https://a.storyblok.com/f/338460/1942x400/2e35c9d70d/shipfox-logotype-orange-black.png"
            alt="Shipfox"
            height={75}
          />
        </picture>
      </div>

      <p
        style={{
          fontWeight: 800,
          fontSize: '82px',
          color: '#1C1C1C',
        }}
      >
        {props.title}
      </p>
      <p
        style={{
          fontSize: '52px',
          color: '#FF4B00',
        }}
      >
        {props.description}
      </p>
    </div>
  );
}
