import React from 'react';
import { Link } from 'react-router-dom';

import './AppErrorView.css';

const AppErrorView = ({
  title = 'Something Went Wrong',
  message = 'We hit an unexpected issue while loading this page.',
  code = 'Error',
  onRetry,
  showHomeLink = true,
}) => {
  return (
    <div className="app-error-view">
      <div className="app-error-view__glow app-error-view__glow--left" />
      <div className="app-error-view__glow app-error-view__glow--right" />
      <div className="app-error-view__card">
        <span className="app-error-view__eyebrow">DAFTAR</span>
        <div className="app-error-view__code">{code}</div>
        <h1 className="app-error-view__title">{title}</h1>
        <p className="app-error-view__message">{message}</p>
        <div className="app-error-view__actions">
          <button className="app-error-view__button app-error-view__button--primary" type="button" onClick={onRetry}>
            Try Again
          </button>
          {showHomeLink ? (
            <Link className="app-error-view__button app-error-view__button--secondary" to="/">
              Back Home
            </Link>
          ) : null}
        </div>
      </div>
    </div>
  );
};

export default AppErrorView;