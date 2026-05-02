import { registerRoot, Composition } from 'remotion';
import { CaptionsComposition } from './CaptionsComposition';

export const RemotionRoot = () => {
  return (
    <Composition
      id="Captions"
      component={CaptionsComposition}
      durationInFrames={300} // Will be overridden dynamically
      fps={30}
      width={1080}
      height={1920}
      defaultProps={{
        videoUrl: '',
        captions: [],
        styleOptions: {},
        videoHeight: 1920
      }}
    />
  );
};

registerRoot(RemotionRoot);
