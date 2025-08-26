import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import VideoPlayer from './video-player';
import { cache } from 'react';

interface VideoData {
  name: string;
  videoUrl: string; // Google Drive File ID
  userId: string;
}

interface VideoPlayerPageProps {
  params: { id: string };
}

// Cria uma função de busca de dados centralizada e em cache
const getVideoData = cache(async (videoId: string): Promise<VideoData | null> => {
  if (!videoId) {
    return null;
  }
  try {
    const videoDocRef = doc(db, 'videos', videoId);
    const videoDocSnap = await getDoc(videoDocRef);

    if (videoDocSnap.exists()) {
      return videoDocSnap.data() as VideoData;
    } else {
      return null;
    }
  } catch (error) {
    console.error('Error fetching video data:', error);
    return null;
  }
});

const getGoogleDriveEmbedLink = (fileId: string) => {
    return `https://drive.google.com/file/d/${fileId}/preview`;
};


// Refatora 'generateMetadata' para usar a função em cache
export async function generateMetadata({ params }: VideoPlayerPageProps): Promise<Metadata> {
  const video = await getVideoData(params.id);

  if (!video) {
    return {
      title: 'Vídeo Não Encontrado',
    };
  }

  const videoUrl = getGoogleDriveEmbedLink(video.videoUrl);

  return {
    title: video.name,
    description: `Assista ao vídeo: ${video.name}`,
    openGraph: {
      title: video.name,
      description: 'Um vídeo compartilhado do VideoVerse',
      type: 'video.other',
      videos: [
        {
          url: videoUrl,
          type: 'text/html', // Change type to html for iframe
          width: 1280,
          height: 720,
        },
      ],
    },
  };
}

// Refatore o componente da página para usar a mesma função em cache
export default async function VideoPlayerPage({ params }: VideoPlayerPageProps) {
  const video = await getVideoData(params.id);

  // Usa 'notFound()' para um tratamento de erro mais idiomático
  if (!video) {
    notFound();
  }

  return (
    <div className="relative flex h-screen w-full flex-col items-center justify-center bg-black">
      <Link
        href="/"
        className="absolute top-4 left-4 z-20 inline-flex items-center rounded-full bg-black/50 p-2 text-sm font-medium text-white transition-colors hover:bg-white/20"
        aria-label="Voltar para Home"
      >
        <ArrowLeft className="h-6 w-6" />
      </Link>
      <VideoPlayer src={getGoogleDriveEmbedLink(video.videoUrl)} title={video.name} />
    </div>
  );
}
