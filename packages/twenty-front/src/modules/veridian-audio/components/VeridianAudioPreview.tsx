import { UnavailableFilePreview } from '@/activities/files/components/UnavailableFilePreview';
import { styled } from '@linaria/react';
import { Trans } from '@lingui/react/macro';
import { useState } from 'react';

const StyledContainer = styled.div`
  align-items: center;
  display: flex;
  height: 100%;
  justify-content: center;
  width: 100%;
`;

const StyledAudio = styled.audio`
  width: 80%;
`;

type VeridianAudioPreviewProps = {
  audioName: string;
  audioUrl: string;
};

// Le serveur sert les fichiers en `attachment` : un lien les télécharge, un <audio> les lit sur place.
export const VeridianAudioPreview = ({
  audioName,
  audioUrl,
}: VeridianAudioPreviewProps) => {
  const [hasFailedToLoad, setHasFailedToLoad] = useState(false);

  if (hasFailedToLoad) {
    return (
      <UnavailableFilePreview
        fileName={audioName}
        fileUrl={audioUrl}
        message={
          // Message déjà présent dans les catalogues amont : un texte neuf n'y serait pas traduit.
          <Trans>
            This file type cannot be previewed. Please download the file to
            view it.
          </Trans>
        }
      />
    );
  }

  return (
    <StyledContainer>
      <StyledAudio
        controls
        preload="metadata"
        src={audioUrl}
        onError={() => setHasFailedToLoad(true)}
      />
    </StyledContainer>
  );
};
