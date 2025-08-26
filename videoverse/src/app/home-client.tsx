'use client';

import {useEffect, useState, useCallback, useRef} from 'react';
import {Button} from '@/components/ui/button';
import {SiGoogledrive} from 'react-icons/si';
import {
  GoogleAuthProvider,
  signInWithPopup,
  onAuthStateChanged,
  User,
} from 'firebase/auth';
import {auth, db} from '@/lib/firebase';
import {
  collection,
  addDoc,
  query,
  where,
  onSnapshot,
  serverTimestamp,
  Timestamp,
  doc,
  deleteDoc,
  updateDoc,
} from 'firebase/firestore';
import {UploadCloud, Video, CheckCircle, Loader2, MoreHorizontal, Trash2, Copy, Pencil, Info, LayoutGrid, List} from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import Link from 'next/link';
import { useToast } from "@/hooks/use-toast"
import Image from 'next/image';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar"
import { uploadVideo } from '@/ai/flows/uploadVideo';
import { cn } from '@/lib/utils';


interface Video {
  id: string;
  name: string;
  thumbnailUrl: string; 
  videoUrl: string; 
  createdAt: Timestamp;
  userId: string;
}

interface VideoDetails extends Video {
    size?: number;
    mimeType?: string;
    driveCreatedAt?: string;
}

const generateVideoThumbnail = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    const videoUrl = URL.createObjectURL(file);
    video.src = videoUrl;

    const cleanup = () => {
      URL.revokeObjectURL(videoUrl);
      video.remove();
    };

    video.onloadeddata = () => {
      // Set time to 1 second to capture a frame.
      video.currentTime = 1;
    };

    video.onseeked = () => {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const context = canvas.getContext('2d');
      if (context) {
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg');
        cleanup();
        resolve(dataUrl);
      } else {
        cleanup();
        reject(new Error('Could not get canvas context for thumbnail.'));
      }
    };

    video.onerror = (e) => {
      cleanup();
      console.error('Error generating thumbnail:', e);
      reject(new Error('Failed to load video for thumbnail generation.'));
    };
  });
};


const fileToDataUri = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            resolve(reader.result as string);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}


function Login({handleSignIn}: {handleSignIn: () => void}) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-background p-24">
      <div className="flex flex-col items-center justify-center space-y-4 text-center">
        <h1 className="text-4xl font-bold">VideoVerse</h1>
        <p className="text-muted-foreground">
          Faça upload e compartilhe seus vídeos com facilidade.
        </p>
        <Button
          variant="outline"
          size="lg"
          onClick={handleSignIn}
          className="mt-4"
        >
          <SiGoogledrive className="mr-2" />
          <span>Login com Google Drive</span>
        </Button>
      </div>
    </main>
  );
}

function Dashboard({user, handleSignOut, getFreshAccessToken}: {user: User; handleSignOut: () => void; getFreshAccessToken: () => Promise<string | null>}) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [uploadingFile, setUploadingFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadSpeed, setUploadSpeed] = useState<number | null>(null);
  const [videos, setVideos] = useState<Video[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast()
  
  // Deletion state
  const [videoToDelete, setVideoToDelete] = useState<Video | null>(null);
  const [isDeleteAlertOpen, setIsDeleteAlertOpen] = useState(false);

  // Rename state
  const [videoToRename, setVideoToRename] = useState<Video | null>(null);
  const [isRenameDialogOpen, setIsRenameDialogOpen] = useState(false);
  const [newVideoName, setNewVideoName] = useState("");
  const [isRenaming, setIsRenaming] = useState(false);

  // Details state
  const [videoForDetails, setVideoForDetails] = useState<VideoDetails | null>(null);
  const [isDetailsDialogOpen, setIsDetailsDialogOpen] = useState(false);
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);
  
  // Layout state
  const [layout, setLayout] = useState<'grid' | 'list'>('grid');


  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, 'videos'), where('userId', '==', user.uid));
    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      const videosData: Video[] = [];
      querySnapshot.forEach((doc) => {
        videosData.push({ id: doc.id, ...doc.data() } as Video);
      });
      setVideos(videosData.sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0)));
    }, (error) => {
        console.error("Firestore snapshot error:", error);
        toast({
            variant: "destructive",
            title: "Erro de permissão",
            description: "Não foi possível carregar os vídeos. Verifique as regras de segurança do Firestore."
        })
    });

    return () => unsubscribe();
  }, [user, toast]);

  const handleUpload = useCallback(async (file: File) => {
    if (!file || !user) return;
    
    if (!file.type.startsWith('video/')) {
        toast({
            variant: "destructive",
            title: "Tipo de arquivo inválido",
            description: "Por favor, selecione um arquivo de vídeo.",
        })
        return;
    }

    setUploadingFile(file);
    setUploadProgress(0);
    setUploadSpeed(0);

    try {
        const accessToken = await getFreshAccessToken();
        if (!accessToken) {
             toast({
                variant: "destructive",
                title: "Autenticação necessária",
                description: "Não foi possível obter a permissão para o upload. Por favor, tente fazer o login novamente.",
            });
            setUploadingFile(null);
            setUploadProgress(null);
            return;
        }
        setUploadProgress(10); 
        
        const [thumbnailUrl, fileDataUri] = await Promise.all([
            generateVideoThumbnail(file),
            fileToDataUri(file)
        ]);
        setUploadProgress(20);

        const startTime = Date.now();
        const { fileId } = await uploadVideo({
            fileDataUri,
            fileName: file.name,
            mimeType: file.type,
            accessToken,
        });

        const endTime = Date.now();
        const durationInSeconds = (endTime - startTime) / 1000;
        const speedBps = durationInSeconds > 0 ? file.size / durationInSeconds : 0;
        setUploadSpeed(speedBps);
        setUploadProgress(90);

        await addDoc(collection(db, 'videos'), {
            userId: user.uid,
            name: file.name,
            videoUrl: fileId,
            thumbnailUrl,
            createdAt: serverTimestamp(),
        });
        
        setUploadProgress(100);
         setTimeout(() => {
           setUploadingFile(null);
           setUploadProgress(null);
           setUploadSpeed(null);
         }, 1500);

    } catch (error: any) {
        console.error("Upload failed:", error);
        toast({
            variant: "destructive",
            title: "O upload falhou",
            description: error.message || "Ocorreu um erro desconhecido.",
        })
        setUploadingFile(null);
        setUploadProgress(null);
        setUploadSpeed(null);
    }
   
  }, [user, getFreshAccessToken, toast]);

  const promptDeleteVideo = (video: Video) => {
    setVideoToDelete(video);
    setIsDeleteAlertOpen(true);
  };

  const handleDeleteVideo = async () => {
    if (!videoToDelete) return;

    const accessToken = await getFreshAccessToken();
    if (!accessToken) {
      toast({ variant: "destructive", title: "Autenticação necessária" });
      setIsDeleteAlertOpen(false);
      return;
    }

    try {
      // 1. Delete from Google Drive
      const response = await fetch(`https://www.googleapis.com/drive/v3/files/${videoToDelete.videoUrl}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${accessToken}` }
      });

      if (!response.ok && response.status !== 404) { // Ignore 404, file might be already deleted
        const errorData = await response.json().catch(() => ({ error: { message: 'Erro desconhecido' } }));
        throw new Error(`Falha ao excluir do Google Drive: ${errorData.error.message}`);
      }
      
      // 2. Delete from Firestore
      await deleteDoc(doc(db, 'videos', videoToDelete.id));

      toast({ title: "Vídeo excluído!", description: `"${videoToDelete.name}" foi removido.` });

    } catch (error: any) {
      console.error("Failed to delete video:", error);
      toast({ variant: "destructive", title: "Erro ao excluir", description: error.message });
    } finally {
      setIsDeleteAlertOpen(false);
      setVideoToDelete(null);
    }
  };

  const handleCopyLink = (videoId: string) => {
    const url = `${window.location.origin}/video/${videoId}`;
    navigator.clipboard.writeText(url);
    toast({ title: "Link copiado!", description: "O link do vídeo foi copiado para a área de transferência." });
  };

  const promptRenameVideo = (video: Video) => {
    setVideoToRename(video);
    setNewVideoName(video.name);
    setIsRenameDialogOpen(true);
  };

  const handleRenameVideo = async () => {
    if (!videoToRename || !newVideoName.trim()) {
        toast({ variant: "destructive", title: "Nome inválido." });
        return;
    }

    setIsRenaming(true);
    const accessToken = await getFreshAccessToken();
     if (!accessToken) {
      toast({ variant: "destructive", title: "Autenticação necessária" });
      setIsRenaming(false);
      return;
    }

    try {
        // 1. Rename in Google Drive
        const response = await fetch(`https://www.googleapis.com/drive/v3/files/${videoToRename.videoUrl}`, {
            method: 'PATCH',
            headers: { 
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ name: newVideoName.trim() })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ error: { message: 'Erro desconhecido' } }));
            throw new Error(`Falha ao renomear no Google Drive: ${errorData.error.message}`);
        }
        
        // 2. Rename in Firestore
        const videoDocRef = doc(db, 'videos', videoToRename.id);
        await updateDoc(videoDocRef, { name: newVideoName.trim() });
        
        toast({ title: "Vídeo renomeado com sucesso!" });
    } catch (error: any) {
        console.error("Failed to rename video:", error);
        toast({ variant: "destructive", title: "Erro ao renomear", description: error.message });
    } finally {
        setIsRenaming(false);
        setIsRenameDialogOpen(false);
        setVideoToRename(null);
    }
  };

  const promptShowDetails = async (video: Video) => {
    setVideoForDetails(video);
    setIsDetailsDialogOpen(true);
    setIsLoadingDetails(true);
    
    const accessToken = await getFreshAccessToken();
    if (!accessToken) {
      toast({ variant: "destructive", title: "Autenticação necessária" });
      setIsLoadingDetails(false);
      return;
    }

    try {
        const response = await fetch(`https://www.googleapis.com/drive/v3/files/${video.videoUrl}?fields=size,mimeType,createdTime`, {
             headers: { 'Authorization': `Bearer ${accessToken}` }
        });
        if (!response.ok) throw new Error("Não foi possível buscar os detalhes do Drive.");
        const driveData = await response.json();
        
        setVideoForDetails({
            ...video,
            size: driveData.size,
            mimeType: driveData.mimeType,
            driveCreatedAt: driveData.createdTime
        });

    } catch (error: any) {
        console.error("Failed to fetch details:", error);
        toast({ variant: "destructive", title: "Erro ao buscar detalhes", description: error.message });
    } finally {
        setIsLoadingDetails(false);
    }
  };


  const handleDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true); 
  };

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      handleUpload(files[0]);
    }
  }, [handleUpload]);
  
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      handleUpload(files[0]);
    }
  };

  const triggerFileSelect = () => {
    fileInputRef.current?.click();
  };

  const formatVideoDate = (timestamp: Timestamp | null) => {
    if (!timestamp) return 'Data desconhecida';
    return timestamp.toDate().toLocaleString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
  }

  const formatBytes = (bytes?: number, decimals = 2) => {
    if (bytes === undefined || bytes === null || bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  }

  const formatSpeed = (bytesPerSecond?: number | null) => {
    if (!bytesPerSecond) return '...';
    const bitsPerSecond = bytesPerSecond * 8;
    if (bitsPerSecond < 1000000) { // less than 1 Mbps
        return `${(bitsPerSecond / 1000).toFixed(0)} Kbps`;
    }
    return `${(bitsPerSecond / 1000000).toFixed(2)} Mbps`;
  }

  const renderVideoList = () => {
    if (videos.length === 0) {
        return (
             <div className="col-span-full flex flex-col items-center justify-center p-8 border rounded-lg bg-card text-card-foreground">
                <p className="text-muted-foreground">Nenhum vídeo encontrado.</p>
              </div>
        )
    }

    if (layout === 'grid') {
        return (
            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {videos.map(video => (
                  <div key={video.id} className="group relative transition-all duration-300 hover:scale-105 hover:shadow-2xl">
                    <Link href={`/video/${video.id}`} className="block w-full aspect-video border rounded-lg overflow-hidden shadow-lg">
                      <div className="absolute w-full h-full">
                      {video.thumbnailUrl ? (
                        <Image
                          src={video.thumbnailUrl}
                          alt={`Thumbnail for ${video.name}`}
                          fill={true}
                          style={{objectFit: 'cover'}}
                          className="transition-transform duration-300"
                        />
                      ) : (
                         <div className="w-full h-full bg-muted flex items-center justify-center">
                            <Video className="w-16 h-16 text-muted-foreground" />
                         </div>
                      )}
                      </div>
                       <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent flex flex-col justify-end p-4">
                           <h3 className="text-white font-bold text-lg truncate" title={video.name}>{video.name}</h3>
                           <p className="text-gray-300 text-sm">{formatVideoDate(video.createdAt)}</p>
                       </div>
                    </Link>
                    <div className="absolute top-2 right-2 z-10">
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-8 w-8 bg-black/50 hover:bg-black/75 text-white">
                                    <MoreHorizontal className="h-4 w-4" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent>
                                <DropdownMenuItem onClick={() => handleCopyLink(video.id)}>
                                    <Copy className="mr-2 h-4 w-4" />
                                    Copiar Link
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => promptRenameVideo(video)}>
                                    <Pencil className="mr-2 h-4 w-4" />
                                    Renomear
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => promptShowDetails(video)}>
                                    <Info className="mr-2 h-4 w-4" />
                                    Detalhes
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem onClick={() => promptDeleteVideo(video)} className="text-red-500 focus:text-red-500">
                                    <Trash2 className="mr-2 h-4 w-4" />
                                    Excluir
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                  </div>
                ))}
            </div>
        )
    }

    if (layout === 'list') {
        return (
            <div className="mt-4 border rounded-lg">
                <div className="grid grid-cols-[120px_1fr_150px_80px] gap-4 font-medium text-muted-foreground p-4 border-b bg-muted/50 text-sm">
                    <div>Thumbnail</div>
                    <div>Nome</div>
                    <div>Data de Upload</div>
                    <div className="text-right">Ações</div>
                </div>
                {videos.map(video => (
                    <div key={video.id} className="grid grid-cols-[120px_1fr_150px_80px] gap-4 items-center p-2 border-b last:border-b-0 hover:bg-muted/50">
                        <Link href={`/video/${video.id}`} className="block w-[100px] aspect-video border rounded-md overflow-hidden shadow-md">
                           <div className="relative w-full h-full">
                             {video.thumbnailUrl ? (
                                <Image
                                  src={video.thumbnailUrl}
                                  alt={`Thumbnail for ${video.name}`}
                                  fill={true}
                                  style={{objectFit: 'cover'}}
                                />
                              ) : (
                                 <div className="w-full h-full bg-muted flex items-center justify-center">
                                    <Video className="w-8 h-8 text-muted-foreground" />
                                 </div>
                              )}
                           </div>
                        </Link>
                         <div className="truncate">
                            <Link href={`/video/${video.id}`} className="font-medium hover:underline truncate" title={video.name}>
                                {video.name}
                            </Link>
                         </div>
                        <div className="text-sm text-muted-foreground">{formatVideoDate(video.createdAt)}</div>
                        <div className="flex justify-end">
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button variant="ghost" size="icon" className="h-8 w-8">
                                        <MoreHorizontal className="h-4 w-4" />
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent>
                                    <DropdownMenuItem onClick={() => handleCopyLink(video.id)}>
                                        <Copy className="mr-2 h-4 w-4" />
                                        Copiar Link
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => promptRenameVideo(video)}>
                                        <Pencil className="mr-2 h-4 w-4" />
                                        Renomear
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => promptShowDetails(video)}>
                                        <Info className="mr-2 h-4 w-4" />
                                        Detalhes
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem onClick={() => promptDeleteVideo(video)} className="text-red-500 focus:text-red-500">
                                        <Trash2 className="mr-2 h-4 w-4" />
                                        Excluir
                                    </DropdownMenuItem>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        </div>
                    </div>
                ))}
            </div>
        )
    }

    return null;
  }


  return (
    <>
    <div className="flex min-h-screen bg-background">
      <aside className="w-64 border-r p-6 flex flex-col">
        <h2 className="text-2xl font-bold">VideoVerse</h2>
        <nav className="mt-8 flex flex-col space-y-2">
          <Button variant="secondary" className="justify-start">
            <Video className="mr-2" />
            Meus Vídeos
          </Button>
        </nav>
        <div className="mt-auto">
          <div className="mt-4 border-t pt-4 flex items-center gap-3">
              <Avatar>
                <AvatarImage src={user.photoURL || undefined} alt={user.displayName || 'User Avatar'} />
                <AvatarFallback>{user.email?.[0].toUpperCase()}</AvatarFallback>
              </Avatar>
              <div className="flex flex-col flex-shrink min-w-0">
                 <p className="text-sm font-medium truncate" title={user.displayName || 'No name'}>{user.displayName}</p>
                <p className="text-sm text-muted-foreground truncate" title={user.email || 'No email'}>{user.email}</p>
                <Button variant="link" onClick={handleSignOut} className="p-0 h-auto justify-start text-xs">
                  Sair
                </Button>
              </div>
          </div>
        </div>
      </aside>
      <main className="flex-1 p-8">
        <input type="file" ref={fileInputRef} onChange={handleFileSelect} accept="video/*" className="hidden" />
        <div
          className={`flex flex-col items-center justify-center p-10 border-2 border-dashed rounded-lg transition-colors cursor-pointer ${
            isDragOver ? 'border-primary bg-primary/10' : 'border-border'
          }`}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onClick={triggerFileSelect}
        >
          <UploadCloud className="w-16 h-16 text-muted-foreground" />
          <p className="mt-4 text-lg font-semibold">
            Arraste e solte seu vídeo aqui
          </p>
          <p className="text-muted-foreground">
            ou clique para selecionar o arquivo
          </p>
           <p className="text-xs text-muted-foreground mt-2">
            Seus vídeos serão salvos em /videoverse no seu Google Drive.
          </p>
        </div>
        
        {uploadingFile && uploadProgress !== null && (
          <div className="mt-4">
            <div className="flex justify-between items-center mb-1">
                <p className="text-sm font-medium truncate pr-4">{uploadingFile.name} ({formatBytes(uploadingFile.size)})</p>
                 {uploadProgress === 100 ? (
                    <div className="flex items-center space-x-2 text-green-500">
                        <span className="text-sm">Concluído!</span>
                        <CheckCircle />
                    </div>
                 ) : (
                    <div className="flex items-center space-x-2">
                        <p className="text-sm text-muted-foreground w-24 text-right">
                           {Math.round(uploadProgress)}%
                           {(uploadSpeed && uploadProgress > 20 && uploadProgress < 90) ? ` (${formatSpeed(uploadSpeed)})` : ''}
                        </p>
                        <Loader2 className="h-4 w-4 animate-spin" />
                    </div>
                 )}
            </div>
            <Progress value={uploadProgress} className="h-2" />
          </div>
        )}

        <section className="mt-8">
            <div className="flex justify-between items-center">
              <h2 className="text-xl font-semibold">Seus Vídeos</h2>
               <div className="flex items-center gap-2">
                    <Button variant={layout === 'grid' ? 'secondary' : 'ghost'} size="icon" onClick={() => setLayout('grid')}>
                        <LayoutGrid className="h-5 w-5" />
                    </Button>
                     <Button variant={layout === 'list' ? 'secondary' : 'ghost'} size="icon" onClick={() => setLayout('list')}>
                        <List className="h-5 w-5" />
                    </Button>
               </div>
            </div>
          {renderVideoList()}
        </section>
      </main>
    </div>

    {/* Delete Alert Dialog */}
    <AlertDialog open={isDeleteAlertOpen} onOpenChange={setIsDeleteAlertOpen}>
        <AlertDialogContent>
            <AlertDialogHeader>
                <AlertDialogTitle>Você tem certeza?</AlertDialogTitle>
                <AlertDialogDescription>
                    Esta ação não pode ser desfeita. Isso excluirá permanentemente o vídeo <strong>{videoToDelete?.name}</strong> do seu Google Drive e dos nossos servidores.
                </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
                <AlertDialogCancel onClick={() => setVideoToDelete(null)}>Cancelar</AlertDialogCancel>
                <AlertDialogAction onClick={handleDeleteVideo} className="bg-destructive hover:bg-destructive/90">
                    Excluir
                </AlertDialogAction>
            </AlertDialogFooter>
        </AlertDialogContent>
    </AlertDialog>

    {/* Rename Dialog */}
    <Dialog open={isRenameDialogOpen} onOpenChange={setIsRenameDialogOpen}>
        <DialogContent>
            <DialogHeader>
                <DialogTitle>Renomear Vídeo</DialogTitle>
                <DialogDescription>
                    Digite um novo nome para o vídeo "{videoToRename?.name}".
                </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
                <Input 
                    value={newVideoName}
                    onChange={(e) => setNewVideoName(e.target.value)}
                    placeholder="Novo nome do vídeo"
                    onKeyDown={(e) => e.key === 'Enter' && handleRenameVideo()}
                />
            </div>
            <DialogFooter>
                <Button variant="outline" onClick={() => setIsRenameDialogOpen(false)}>Cancelar</Button>
                <Button onClick={handleRenameVideo} disabled={isRenaming}>
                    {isRenaming && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Salvar
                </Button>
            </DialogFooter>
        </DialogContent>
    </Dialog>
    
    {/* Details Dialog */}
    <Dialog open={isDetailsDialogOpen} onOpenChange={setIsDetailsDialogOpen}>
        <DialogContent>
            <DialogHeader>
                <DialogTitle>Detalhes do Vídeo</DialogTitle>
                 <DialogDescription>
                    {videoForDetails?.name}
                </DialogDescription>
            </DialogHeader>
             {isLoadingDetails ? (
                <div className="flex items-center justify-center p-8">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
             ) : (
                <div className="grid gap-2 text-sm py-4">
                    <div className="flex justify-between"><span className="text-muted-foreground">ID (Firestore):</span> <span>{videoForDetails?.id}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">ID (Drive):</span> <span className="truncate max-w-[200px]">{videoForDetails?.videoUrl}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Upload (App):</span> <span>{formatVideoDate(videoForDetails?.createdAt || null)}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Criação (Drive):</span> <span>{videoForDetails?.driveCreatedAt ? new Date(videoForDetails.driveCreatedAt).toLocaleString('pt-BR') : 'N/A'}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Tamanho:</span> <span>{formatBytes(videoForDetails?.size)}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Tipo Mime:</span> <span>{videoForDetails?.mimeType}</span></div>
                </div>
             )}
            <DialogFooter>
                <Button onClick={() => setIsDetailsDialogOpen(false)}>Fechar</Button>
            </DialogFooter>
        </DialogContent>
    </Dialog>
    </>
  );
}

export default function HomeClient() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast()
  
  const accessTokenRef = useRef<{token: string | null, expires: number}>({token: null, expires: 0});

  const getFreshAccessToken = useCallback(async (): Promise<string | null> => {
    const now = Date.now();
    if (accessTokenRef.current.token && now < accessTokenRef.current.expires - 5 * 60 * 1000) {
        return accessTokenRef.current.token;
    }

    if (!auth.currentUser) {
        toast({
            variant: "destructive",
            title: "Login necessário",
            description: "Sua sessão expirou. Por favor, faça o login novamente.",
        });
        return null;
    }
    
    try {
      const provider = new GoogleAuthProvider();
      provider.addScope('https://www.googleapis.com/auth/drive');

      // This will either be a silent re-authentication or a quick popup if session is stale.
      const result = await signInWithPopup(auth, provider);
      const credential = GoogleAuthProvider.credentialFromResult(result);
      
      if (credential?.accessToken) {
        const expirationTime = (result.user as any).stsTokenManager.expirationTime;
        accessTokenRef.current = { token: credential.accessToken, expires: expirationTime }; 
        setUser(result.user);
        return credential.accessToken;
      }
      
      throw new Error("Não foi possível obter o token de acesso do Google.");

    } catch (error: any) {
       console.error("Erro ao obter novo token:", error);
       if (error.code !== 'auth/popup-closed-by-user' && error.code !== 'auth/cancelled-popup-request') {
         toast({
           variant: "destructive",
           title: "Falha na autenticação",
           description: "Não foi possível obter permissão do Google Drive. Tente novamente.",
         });
       }
       accessTokenRef.current = {token: null, expires: 0};
       handleSignOut();
       return null;
    }
  }, [toast]);


  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setLoading(true);
      if (currentUser) {
          setUser(currentUser);
      } else {
          setUser(null);
          accessTokenRef.current = {token: null, expires: 0};
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const handleSignIn = async () => {
    setLoading(true);
    const provider = new GoogleAuthProvider();
    provider.addScope('https://www.googleapis.com/auth/drive');
    try {
      const result = await signInWithPopup(auth, provider);
      const credential = GoogleAuthProvider.credentialFromResult(result);
      if (credential?.accessToken) {
          const expirationTime = (result.user as any).stsTokenManager.expirationTime;
          accessTokenRef.current = { token: credential.accessToken, expires: expirationTime };
          setUser(result.user);
      } else {
          throw new Error("Não foi possível obter credenciais do Google.");
      }
    } catch (error: any) {
        console.error('Error during sign-in:', error);
         if (error.code !== 'auth/popup-closed-by-user') {
            toast({
               variant: "destructive",
               title: "Erro de Login",
               description: error.message || "Ocorreu um erro desconhecido.",
            });
        }
    } finally {
        setLoading(false);
    }
  };
  
  const handleSignOut = async () => {
    try {
      await auth.signOut();
      setUser(null);
      accessTokenRef.current = {token: null, expires: 0};
    } catch (error: any) {
      console.error('Error signing out:', error);
      toast({
         variant: "destructive",
         title: "Erro ao Sair",
         description: error.message || "Ocorreu um erro desconhecido ao tentar sair.",
      });
    }
  };
  
  if (loading) {
     return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-background p-24">
        <Loader2 className="h-16 w-16 animate-spin" />
      </main>
    );
  }

  if (user) {
    return <Dashboard user={user} handleSignOut={handleSignOut} getFreshAccessToken={getFreshAccessToken} />;
  }

  return <Login handleSignIn={handleSignIn} />;
}
