# Booth Price & Tag Batch

BOOTH 상품 편집 화면에서 가격, 태그, 옵션별 Digital Files를 일괄 처리하는 Tampermonkey 유저스크립트 겸 Chrome Extension입니다.

현재 버전: `2.2.1`

## 설치

### Tampermonkey 정식 링크

[https://studio-iyan-booth-batch.pages.dev/booth-batch.user.js](https://studio-iyan-booth-batch.pages.dev/booth-batch.user.js)

### Tampermonkey beta 호환 링크

[https://studio-iyan-booth-batch.pages.dev/beta/booth-batch.user.js](https://studio-iyan-booth-batch.pages.dev/beta/booth-batch.user.js)

기존 beta 링크로 설치한 사용자의 자동 업데이트가 끊기지 않도록 같은 빌드가 beta 경로에도 생성됩니다. 새로 안내할 때는 정식 링크를 사용하세요.

## 지원 환경

- 대상 페이지: `https://manage.booth.pm/items/*/edit`
- Tampermonkey
- Chrome Extension Manifest V3
- UI 언어: 한국어, English, 日本語

## 주요 기능

- 가격 일괄 설정
- 가격 원 단위 증감
- 가격 퍼센트 증감
- 반올림 단위 선택: 없음, 1, 10, 100
- React 입력 필드 대응을 위한 직접 타이핑 모드
- 태그 추가
- 기존 태그 삭제 후 태그 교체
- 태그 입력 시 BOOTH 추천어 선택을 피하고 입력값 그대로 확정
- 옵션별 Digital Files 교체
- 옵션명 기반 파일 자동 매칭
- 공통 파일 키워드 지정
- `Full Pack` 옵션은 전체 파일 체크
- 작업 중단 버튼
- 변경된 입력 필드 표시
- 패널 드래그 및 위치 저장
- 패널 내부 언어 선택 및 저장

## 언어 선택

이전처럼 한/영/일 설치 파일을 따로 나누지 않습니다. 하나의 userscript 또는 Chrome Extension 안에서 패널 상단의 언어 선택 드롭다운으로 언어를 바꿉니다.

선택한 언어는 브라우저 `localStorage`에 저장되며 다음 실행 시에도 유지됩니다.

## 빌드

```bash
npm install
npm run build
```

빌드 결과:

```text
dist/booth-batch.user.js
dist/beta/booth-batch.user.js
dist/chrome-extension/
```

개별 빌드:

```bash
npm run build:userscript
npm run build:extension
```

## Chrome Extension 로컬 테스트

1. `npm run build` 실행
2. Chrome에서 `chrome://extensions` 열기
3. Developer mode 활성화
4. Load unpacked 선택
5. `dist/chrome-extension` 폴더 선택

## 릴리스

태그를 푸시하면 GitHub Actions가 자동으로 빌드하고 Chrome Extension ZIP을 생성합니다.

```bash
git tag v2.2.1
git push origin v2.2.1
```

태그 워크플로 결과:

- `dist` artifact 업로드
- `booth-batch-chrome-extension-vX.Y.Z.zip` 생성
- GitHub Release 생성 또는 기존 Release asset 갱신

## 프로젝트 구조

```text
src/booth-batch.user.js      # 공통 런타임 소스
src/i18n/messages.json       # 한국어/영어/일본어 번역
src/chrome/manifest.json     # Chrome Extension manifest 템플릿
scripts/build.mjs            # userscript + extension 통합 빌드
public/index.html            # 설치 안내 페이지
.github/workflows/check.yml  # 빌드 및 태그 릴리스 워크플로
```

## 배포 산출물 정책

`dist/`는 빌드 산출물이므로 git에 커밋하지 않습니다. GitHub Actions artifact와 Release asset으로 배포합니다.
