import {
  Aperture,
  ArrowRight,
  GitBranch,
  Images,
  ShieldCheck,
} from 'lucide-react';

import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const proofPoints = [
  { icon: Images, label: 'Originals preserved' },
  { icon: GitBranch, label: 'Visual version history' },
  { icon: ShieldCheck, label: 'Private by default' },
];

export default function Home() {
  return (
    <main className="landing-shell">
      <div className="scene" aria-hidden="true">
        <img
          className="scene-background"
          src="/artwork/japanese-village-bg.png"
          alt=""
        />
        <img className="scene-sun" src="/artwork/sun.png" alt="" />
        <img className="scene-clouds" src="/artwork/clouds.png" alt="" />
        <div className="scene-wash" />
      </div>

      <header className="site-header">
        <a className="brand" href="#top" aria-label="PhotoGit home">
          <span className="brand-mark">
            <Aperture aria-hidden="true" />
          </span>
          <span>PhotoGit</span>
        </a>

        <nav className="primary-nav" aria-label="Main navigation">
          <a href="#workflow">How it works</a>
          <a href="#galleries">Galleries</a>
          <a href="#creators">For creators</a>
        </nav>

        <div className="header-actions">
          <a className="sign-in-link" href="#signin">
            Sign in
          </a>
          <a
            className={cn(buttonVariants({ size: 'lg' }), 'pixel-button header-cta')}
            href="#start"
          >
            Start free
          </a>
        </div>
      </header>

      <section id="top" className="hero" aria-labelledby="hero-title">
        <div className="hero-copy">
          <p className="eyebrow">
            <span aria-hidden="true" />
            Version control for photographers
          </p>

          <h1 id="hero-title">
            Every edit.
            <br />
            Never lose the <em>original.</em>
          </h1>

          <p className="hero-description">
            PhotoGit keeps every photo, revision, and creative decision in one
            beautiful visual history—ready to compare, restore, or share.
          </p>

          <div className="hero-actions" id="start">
            <a
              className={cn(buttonVariants({ size: 'lg' }), 'pixel-button primary-cta')}
              href="#new-repository"
            >
              Create a photo repo
              <ArrowRight aria-hidden="true" />
            </a>
            <a
              className={cn(
                buttonVariants({ variant: 'outline', size: 'lg' }),
                'pixel-button secondary-cta',
              )}
              href="#galleries"
            >
              Explore galleries
            </a>
          </div>

          <div className="proof-points" id="workflow" aria-label="PhotoGit highlights">
            {proofPoints.map(({ icon: Icon, label }) => (
              <div className="proof-point" key={label}>
                <Icon aria-hidden="true" />
                <span>{label}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="scene-caption" aria-hidden="true">
        <span>01</span>
        <span className="caption-line" />
        <span>Keep the whole journey</span>
      </div>
    </main>
  );
}
