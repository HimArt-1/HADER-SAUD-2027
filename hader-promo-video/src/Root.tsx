import { Composition } from 'remotion';
import { MainVideo } from './MainVideo';

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="HaderPromo"
        component={MainVideo}
        durationInFrames={2600} /* Extended for infographics */
        fps={60}
        width={1920}
        height={1080} /* Landscape for YouTube/Web */
      />
    </>
  );
};
