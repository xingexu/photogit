import Image from 'next/image';

export default function Home() {
  return (
    <main className="landing-shell">
      <h1 className="sr-only">PhotoGit</h1>

      <figure className="landscape-frame">
        <Image
          className="landscape-art"
          src="/artwork/japanese-village-hero.png"
          alt="A bright pixel-art Japanese village with pagodas, mountain peaks, a torii gate, and blooming sakura trees"
          fill
          priority
          unoptimized
          sizes="(max-width: 900px) 100vw, 76.5vw"
        />
      </figure>
    </main>
  );
}
