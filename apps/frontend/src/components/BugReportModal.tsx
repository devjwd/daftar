import React, { useState, useEffect, useRef } from 'react';
import { useWallet } from '@aptos-labs/wallet-adapter-react';
import { submitBugReport } from '../services/api';
import './BugReportModal.css';

interface BugReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialType?: string;
  initialSymbol?: string;
  initialAddress?: string;
  initialDescription?: string;
}

export const BugReportModal: React.FC<BugReportModalProps> = ({
  isOpen,
  onClose,
  initialType = 'general',
  initialSymbol = '',
  initialAddress = '',
  initialDescription = ''
}) => {
  const { account, connected } = useWallet();
  const [type, setType] = useState('general');
  const [tokenSymbol, setTokenSymbol] = useState('');
  const [tokenAddress, setTokenAddress] = useState('');
  const [description, setDescription] = useState('');
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
      setType(initialType);
      setTokenSymbol(initialSymbol);
      setTokenAddress(initialAddress);
      setDescription(initialDescription);
      setScreenshot(undefined);
      setFileName('');
      setIsSubmitting(false);
      setIsSubmitted(false);
      setError(null);
    }
  }, [isOpen, initialType, initialSymbol, initialAddress]);

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
    if (!description.trim()) return;

    setIsSubmitting(true);
    setError(null);

    const walletAddress = connected && account?.address ? String(account.address) : undefined;

    try {
      const result = await submitBugReport({
        type,
        description,
        screenshot,
        walletAddress,
        tokenSymbol: type === 'token' ? tokenSymbol : undefined,
        tokenAddress: type === 'token' ? tokenAddress : undefined,
      });

      if (result.ok) {
        setIsSubmitted(true);
      } else {
        setError(result.error || 'Failed to submit report. Please try again.');
      }
    } catch (err: any) {
      setError(err.message || 'An unexpected error occurred.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="bug-modal-overlay" onClick={onClose}>
      <div className="bug-modal" onClick={(e) => e.stopPropagation()}>
        <button 
          className="bug-modal-close" 
          onClick={onClose}
          aria-label="Close modal"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>

        {!isSubmitted ? (
          <form onSubmit={handleSubmit} className="bug-form">
            <h2 className="bug-modal-title">Report an Issue</h2>
            
            <div className="bug-group">
              <label htmlFor="bug-type" className="bug-label">
                What kind of issue are you reporting?
              </label>
              <div className="bug-select-wrapper">
                <select
                  id="bug-type"
                  value={type}
                  onChange={(e) => setType(e.target.value)}
                  className="bug-select"
                  disabled={isSubmitting}
                >
                  <option value="general">General Bug</option>
                  <option value="token">Incorrect Token Data</option>
                  <option value="layout">Layout / CSS Issue</option>
                  <option value="transaction">Transaction Issue</option>
                  <option value="other">Other</option>
                </select>
                <div className="bug-select-arrow">▼</div>
              </div>
            </div>

            {type === 'token' && (
              <div className="bug-token-fields animation-slide-down">
                <div className="bug-group">
                  <label htmlFor="bug-token-symbol" className="bug-label">
                    Token Symbol
                  </label>
                  <input
                    type="text"
                    id="bug-token-symbol"
                    value={tokenSymbol}
                    onChange={(e) => setTokenSymbol(e.target.value)}
                    placeholder="e.g. MOVE"
                    className="bug-input"
                    required={type === 'token'}
                    disabled={isSubmitting}
                  />
                </div>
                <div className="bug-group">
                  <label htmlFor="bug-token-address" className="bug-label">
                    Token Address
                  </label>
                  <input
                    type="text"
                    id="bug-token-address"
                    value={tokenAddress}
                    onChange={(e) => setTokenAddress(e.target.value)}
                    placeholder="0x..."
                    className="bug-input"
                    required={type === 'token'}
                    disabled={isSubmitting}
                  />
                </div>
              </div>
            )}

            <div className="bug-group">
              <label htmlFor="bug-description" className="bug-label">
                Description / Steps to Reproduce
              </label>
              <textarea
                id="bug-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={
                  type === 'token'
                    ? 'Please describe what data is incorrect (e.g. incorrect price, decimals, etc.)'
                    : 'Provide details to help us reproduce and fix the bug.'
                }
                className="bug-textarea"
                rows={4}
                required
                disabled={isSubmitting}
              />
            </div>

            <div className="bug-group">
              <span className="bug-label">Upload screenshot (Optional)</span>
              
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
                  className="bug-upload-btn"
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
                <div className="bug-screenshot-preview-container">
                  <div className="bug-screenshot-preview">
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

            {error && <div className="bug-error-msg">{error}</div>}

            <div className="bug-actions">
              <button
                type="button"
                className="bug-btn-cancel"
                onClick={onClose}
                disabled={isSubmitting}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="bug-btn-submit"
                disabled={isSubmitting || !description.trim()}
              >
                {isSubmitting ? (
                  <div className="bug-submit-spinner">
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
          <div className="bug-success-state">
            <div className="success-icon-wrapper">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="success-checkmark">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <h3 className="success-title">Report Submitted!</h3>
            <p className="success-text">
              Thank you for helping us improve DAFTAR. Our team will review this issue shortly.
            </p>
            <button 
              type="button" 
              className="bug-btn-success-close" 
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
