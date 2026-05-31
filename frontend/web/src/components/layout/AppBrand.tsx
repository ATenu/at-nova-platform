import { APP_TAGLINE } from '@/lib/branding';
import { env } from '@/lib/env';

type AppBrandVariant = 'hero' | 'compact';

/**
 * Logo + product name (+ optional tagline). Use `hero` on marketing surfaces
 * (login header, full-screen states); `compact` in the sidebar.
 */
export function AppBrand({ variant = 'hero' }: { variant?: AppBrandVariant }) {
  return (
    <div className={`app-brand app-brand--${variant}`}>
      <img className="app-brand__logo" src="/nova.svg" width={variant === 'hero' ? 44 : 30} height={variant === 'hero' ? 44 : 30} alt="" />
      <div className="app-brand__copy">
        <span className="app-brand__name">{env.appName}</span>
        <p className={`app-brand__tagline ${variant === 'compact' ? 'app-brand__tagline--compact' : ''}`}>
          {APP_TAGLINE}
        </p>
      </div>
    </div>
  );
}
