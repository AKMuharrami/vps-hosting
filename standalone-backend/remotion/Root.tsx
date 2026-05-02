import { Composition, getInputProps } from 'remotion';
import { CaptionsComposition } from './CaptionsComposition';

export const RemotionRoot = () => {
	const props = getInputProps() as any;

	return (
		<>
			<Composition
				id="Captions"
				component={CaptionsComposition}
				durationInFrames={Number(props.durationInFrames) || 300}
				fps={30}
				width={Number(props.videoWidth) || 1080}
				height={Number(props.videoHeight) || 1920}
				defaultProps={props}
			/>
		</>
	);
};