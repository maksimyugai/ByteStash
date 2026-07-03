import React from 'react';
import { Shield } from 'lucide-react';
import { Link, Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../hooks/useAuth';
import { PageContainer } from '../common/layout/PageContainer';
import { ROUTES } from '../../constants/routes';

/*
 * Authentication is handled at the edge by Cloudflare Access — there is no
 * internal login form. Reaching this page unauthenticated normally means the
 * Access session could not be resolved (expired session on a bypassed path,
 * deactivated account, or a misconfigured deployment).
 */
export const LoginPage: React.FC = () => {
  const { isAuthenticated, isLoading } = useAuth();
  const { t } = useTranslation();
  const { t: translate } = useTranslation('components/auth');

  if (isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  return (
    <PageContainer className="flex items-center justify-center min-h-screen">
      <div className="max-w-md w-full space-y-8">
        <div>
          <h2 className="mt-6 text-center text-3xl font-bold text-light-text dark:text-dark-text">
            ByteStash
          </h2>
          <p className="mt-2 text-center text-sm text-light-text-secondary dark:text-dark-text-secondary">
            {translate('login.pleaseSignInToContinue')}
            {' '}{t('or')}{' '}
            <Link to={ROUTES.PUBLIC_SNIPPETS} className="text-light-primary dark:text-dark-primary hover:opacity-80">
              {translate('login.browsePublicSnippets')}
            </Link>
          </p>
        </div>

        <button
          // The Access application guards only this path; passing through it
          // sets the domain-wide CF_Authorization cookie
          onClick={() => { window.location.href = '/auth/login'; }}
          disabled={isLoading}
          className="w-full flex items-center justify-center gap-2 px-4 py-2
            bg-light-primary dark:bg-dark-primary text-white rounded-md hover:opacity-90 transition-colors
            disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Shield size={16} />
          {translate('signIn.with', { displayName: 'Cloudflare Access' })}
        </button>
      </div>
    </PageContainer>
  );
};
