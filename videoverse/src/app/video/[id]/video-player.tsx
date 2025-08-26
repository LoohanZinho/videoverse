'use client';

interface VideoPlayerProps {
    src: string;
    title: string;
}

export default function VideoPlayer({ src, title }: VideoPlayerProps) {
    return (
        <div className="w-full h-full bg-black flex items-center justify-center">
            <iframe
                src={src}
                title={title}
                className="w-full h-full border-0"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
            ></iframe>
        </div>
    );
}
