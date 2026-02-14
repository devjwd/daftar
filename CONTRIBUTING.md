# Contributing to Movement Network Portfolio Manager

Thank you for considering contributing to this project! Here's how you can help.

## Code of Conduct

- Be respectful and inclusive
- Focus on the code, not the person
- Help maintain a welcoming environment
- Report violations to `conduct@movementnetwork.xyz`

## Getting Started

### 1. Fork & Clone
```bash
git clone https://github.com/your-username/movement-portfolio.git
cd movement-portfolio
```

### 2. Setup Development Environment

#### Frontend
```bash
cd frontend
npm install
cp .env.example .env.local
npm run dev
```

#### Contracts
```bash
cd contracts/swap_router
movement move compile
movement move test
```

### 3. Branch Naming
Use conventional names:
- `feature/add-dark-mode` - New feature
- `fix/balance-calculation` - Bug fix
- `docs/update-readme` - Documentation
- `refactor/simplify-hooks` - Code improvement
- `test/add-unit-tests` - Test additions

### 4. Commit Messages

Follow conventional commits:
```
type(scope): subject

- feat: New feature
- fix: Bug fix
- docs: Documentation
- style: Formatting (no logic change)
- refactor: Code reorganization
- perf: Performance improvement
- test: Test additions/changes
- ci: CI/CD changes
- chore: Dependencies, config, etc.

Examples:
  feat(swap): add slippage warning UI
  fix(indexer): handle empty GraphQL responses
  docs(setup): add deployment instructions
  test(hooks): add useTokenPrices unit tests
```

### 5. Code Style

#### JavaScript/React
- ESLint: `npm run lint`
- No console.log in production (use proper logging)
- Prefer functional components
- Use descriptive variable names
- Add JSDoc for functions

#### Move Contracts
- Use clear naming conventions
- Add inline comments for complex logic
- Test with `movement move test`
- Document public functions

#### CSS
- Use existing CSS variables
- Mobile-first responsive design
- Follow glassmorphism design system
- Test on multiple screen sizes

### 6. Testing Requirements

Before submitting a PR:

```bash
cd frontend

# Lint check
npm run lint

# Run tests
npm run test

# Build check
npm run build

# Type check (if using TypeScript)
npm run type-check
```

### 7. PR Guidelines

#### Before Submitting
- [ ] Code follows project style
- [ ] Tests pass: `npm run test`
- [ ] Linter passes: `npm run lint`
- [ ] Build succeeds: `npm run build`
- [ ] No console errors/warnings
- [ ] Commit messages are descriptive
- [ ] No breaking changes (or documented)

#### PR Description Template
```markdown
## Description
Brief description of changes

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update

## Motivation
Why this change is needed

## Testing Performed
How to test these changes

## Screenshots (if UI changes)
Add relevant screenshots

## Checklist
- [ ] Tests pass
- [ ] Lint passes
- [ ] Build succeeds
- [ ] No console errors
```

### 8. File Organization

```
frontend/
├── src/
│   ├── components/     # Reusable UI components
│   ├── pages/          # Route-level components
│   ├── hooks/          # Custom React hooks
│   ├── services/       # API & blockchain services
│   ├── config/         # Configuration files
│   ├── utils/          # Utility functions
│   └── styles/         # Global styles
├── public/             # Static assets
├── tests/              # Test files
└── vite.config.js      # Build config
```

### 9. Naming Conventions

#### Components
```javascript
// PascalCase
function ProfileCard() {}
function TokenSelector() {}
```

#### Hooks
```javascript
// useXxx convention
function useTokenPrices() {}
function useDeFiPositions() {}
```

#### Files
```
components/
  ProfileCard.jsx          # Component file
  ProfileCard.css          # Component styles
  ProfileCard.test.jsx     # Component tests

hooks/
  useTokenPrices.js       # Hook file
```

#### Variables/Functions
```javascript
// camelCase
const walletAddress = "0x...";
function formatTokenValue() {}
const isValidAddress = true;
```

### 10. Documentation Standards

#### JSDoc Comments
```javascript
/**
 * Fetch token prices from CoinGecko
 * @param {string[]} tokenIds - Array of CoinGecko token IDs
 * @param {object} options - Fetch options
 * @param {number} options.timeout - Request timeout in ms
 * @returns {Promise<Object>} Price map {tokenId: price}
 * @throws {Error} If fetch fails after retries
 */
export async function fetchTokenPrices(tokenIds, options = {}) {
  // Implementation
}
```

#### Component Props
```javascript
/**
 * Display token balance with USD value
 * @param {Object} props
 * @param {string} props.address - Token address
 * @param {number} props.balance - Raw balance value
 * @param {number} props.decimals - Token decimals
 * @param {string} [props.symbol] - Optional token symbol
 * @returns {React.ReactElement}
 */
function TokenCard({ address, balance, decimals, symbol }) {
  // Implementation
}
```

### 11. Common Contribution Areas

**High Impact**
- [ ] Add unit tests
- [ ] Performance optimizations
- [ ] Security improvements
- [ ] Documentation enhancements
- [ ] Error handling improvements

**Medium Impact**
- [ ] New UI features
- [ ] Bug fixes
- [ ] Code refactoring
- [ ] Accessibility improvements

**Good for Beginners**
- [ ] Fix typos
- [ ] Add comments
- [ ] Improve error messages
- [ ] Add missing alt text

### 12. Getting Help

- **Questions**: Open a Discussion on GitHub
- **Bugs**: Open an Issue with reproduction steps
- **Security**: See SECURITY.md for vulnerability reporting
- **Chat**: Join Movement Network Discord

### 13. Deployment & Releases

#### Versioning
We follow Semantic Versioning (MAJOR.MINOR.PATCH)

- **MAJOR**: Breaking changes
- **MINOR**: New features (backward compatible)
- **PATCH**: Bug fixes

#### Release Process
1. Update version in `package.json`
2. Update `CHANGELOG.md`
3. Create git tag: `git tag v1.2.3`
4. Push to main
5. GitHub Actions will build and deploy

### 14. Legal

By contributing, you agree that:
- Your contributions are your own original work
- You grant the project a license to use your contributions
- You understand your contributions will be under the MIT License

---

## Questions?

- **Documentation**: See `/frontend/README.md` and `/QUICKSTART.md`
- **Issues**: Check existing issues before opening new ones
- **Discussions**: Use GitHub Discussions for questions

**Thank you for contributing! 🎉**
