import React, { useState, useEffect, useRef } from 'react';
import { useWallet } from '@aptos-labs/wallet-adapter-react';
import { submitFeedback } from '../services/api';
import './FeedbackModal.css';

interface FeedbackModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const FeedbackModal: React.FC<FeedbackModalProps> = ({ isOpen, onClose }) => {
  const { account, connected } = useWallet();
  const [feature, setFeature] = useState('Portfolio');
  const [feedbackText, setFeedbackText] = useState('');
  const [screenshot, setScreenshot] = useState<string | undefined>(undefined);
  const [fileName, setFileName] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Handle ESC key to close modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Reset form when modal is opened/closed
  useEffect(() => {
    if (isOpen) {
      setFeature('Portfolio');
      setFeedbackText('');
      setScreenshot(undefined);
      setFileName('');
      setIsSubmitting(false);
      setIsSubmitted(false);
      setError(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setError('Please upload an image file (PNG, JPG, JPEG, etc.)');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setError('File size must be under 5MB');
      return;
    }

    setError(null);
    setFileName(file.name);

    const reader = new FileReader();
    reader.onloadend = () => {
      setScreenshot(reader.result as string);
    };
    reader.onerror = () => {
      setError('Failed to read image file');
    };
    reader.readAsDataURL(file);
  };

  const handleChooseFileClick = () => {
    fileInputRef.current?.click();
  };

  const handleRemoveScreenshot = (e: React.MouseEvent) => {
    e.stopPropagation();
    setScreenshot(undefined);
    setFileName('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!feedbackText.trim()) return;

    setIsSubmitting(true);
    setError(null);

    const walletAddress = connected && account?.address ? String(account.address) : undefined;

    try {
      const result = await submitFeedback({
        feature,
        feedbackText,
        screenshot,
        walletAddress,
      });

      if (result.ok) {
        setIsSubmitted(true);
      } else {
        setError(result.error || 'Failed to submit feedback. Please try again.');
      }
    } catch (err: any) {
      setError(err.message || 'An unexpected error occurred.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="feedback-modal-overlay" onClick={onClose}>
      <div className="feedback-modal" onClick={(e) => e.stopPropagation()}>
        <button 
          className="feedback-modal-close" 
          onClick={onClose}
          aria-label="Close modal"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>

        {!isSubmitted ? (
          <form onSubmit={handleSubmit} className="feedback-form">
            <div className="feedback-group">
              <label htmlFor="feedback-feature" className="feedback-label">
                Which feature is your feedback on?
              </label>
              <div className="feedback-select-wrapper">
                <select
                  id="feedback-feature"
                  value={feature}
                  onChange={(e) => setFeature(e.target.value)}
                  className="feedback-select"
                  disabled={isSubmitting}
                >
                  <option value="Portfolio">Portfolio</option>
                  <option value="Swap">Swap</option>
                  <option value="Badges">Badges</option>
                  <option value="Leaderboard">Leaderboard</option>
                  <option value="XP / Level">XP / Level</option>
                  <option value="General / Other">General / Other</option>
                </select>
                <div className="feedback-select-arrow">▼</div>
              </div>
            </div>

            <div className="feedback-group">
              <label htmlFor="feedback-text" className="feedback-label">
                Share your thoughts!
              </label>
              <textarea
                id="feedback-text"
                value={feedbackText}
                onChange={(e) => setFeedbackText(e.target.value)}
                placeholder="Let us know what you love or how we can do better."
                className="feedback-textarea"
                rows={4}
                required
                disabled={isSubmitting}
              />
            </div>

            <div className="feedback-group">
              <span className="feedback-label">Upload screenshot (Optional)</span>
              
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileChange}
                accept="image/*"
                style={{ display: 'none' }}
                disabled={isSubmitting}
              />

              {!screenshot ? (
                <button
                  type="button"
                  className="feedback-upload-btn"
                  onClick={handleChooseFileClick}
                  disabled={isSubmitting}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="upload-icon">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="17 8 12 3 7 8" />
                    <line x1="12" y1="3" x2="12" y2="15" />
                  </svg>
                  Choose File
                </button>
              ) : (
                <div className="feedback-screenshot-preview-container">
                  <div className="feedback-screenshot-preview">
                    <img src={screenshot} alt="Screenshot preview" className="screenshot-img" />
                    <div className="screenshot-info-overlay">
                      <span className="screenshot-name">{fileName}</span>
                      <button
                        type="button"
                        className="remove-screenshot-btn"
                        onClick={handleRemoveScreenshot}
                        title="Remove screenshot"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <path d="M18 6L6 18M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {error && <div className="feedback-error-msg">{error}</div>}

            <div className="feedback-actions">
              <button
                type="button"
                className="feedback-btn-cancel"
                onClick={onClose}
                disabled={isSubmitting}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="feedback-btn-submit"
                disabled={isSubmitting || !feedbackText.trim()}
              >
                {isSubmitting ? (
                  <div className="feedback-submit-spinner">
                    <div className="spinner-dot"></div>
                    <div className="spinner-dot"></div>
                    <div className="spinner-dot"></div>
                  </div>
                ) : (
                  'Submit'
                )}
              </button>
            </div>
          </form>
        ) : (
          <div className="feedback-success-state">
            <div className="success-icon-wrapper">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="success-checkmark">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <h3 className="success-title">Feedback Submitted!</h3>
            <p className="success-text">
              Thank you for your thoughts. Your feedback helps us build a better experience for everyone.
            </p>
            <button 
              type="button" 
              className="feedback-btn-success-close" 
              onClick={onClose}
            >
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
