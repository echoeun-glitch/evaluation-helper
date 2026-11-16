# 평가 입력기

전담교사용 평가 의견 입력 웹앱 — https://echoeun-glitch.github.io/evaluation-helper/

- 영역별 주요 활동·평가 기준 입력 → 최상·상·중·하 의견 8개씩
- 학생별로 척도를 고르면 영역별 문장을 조합해 복사 (같은 척도끼리 문장 중복 최소화)
- 과목별로 따로 저장, 글자 수·바이트 표시

## 의견 만들기

두 가지 방법이 있습니다.

1. **의견 생성 (자동):** 영역 카드의 «의견 생성»을 누르면 서버가 Claude에게 의견 32개를 받아 바로 채웁니다. 30초~1분 걸립니다.
2. **직접 AI에 묻기:** «직접 AI에 묻기» → «프롬프트 복사» → Claude 등 AI에 붙여 넣기 → 받은 답을 붙여 넣고 «의견 넣기». 서버가 꺼져 있거나 오늘 횟수를 다 쓴 경우에도 이 방법은 늘 쓸 수 있습니다.

## 개인정보

- 입력한 내용(영역, 의견, 학생 표)은 **이 브라우저(localStorage)에만** 저장됩니다.
- «의견 생성»을 누를 때만 **과목·학년·영역 이름·주요 활동·평가 기준**이 의견 생성 서버(Firebase Functions)를 거쳐 Anthropic의 Claude API로 전송됩니다. 학생 표의 내용(학생별 척도·의견)은 보내지 않습니다.
- 서버는 하루 사용 횟수를 세려고 요청한 IP 주소를 해시(SHA-256)한 값만 Firestore에 남기며, 입력 내용은 저장하지 않습니다.
- 평가 기준에 학생 이름 같은 개인정보를 적지 마세요.

## 의견 생성 서버 (`functions/`)

Firebase Functions 2세대 함수 `generateOpinions` 하나입니다.

| 항목 | 값 |
|---|---|
| Firebase 프로젝트 | `teachingdiary-d14d5` (`.firebaserc`) |
| 지역 | `asia-northeast3` (서울) |
| 주소 | `https://asia-northeast3-teachingdiary-d14d5.cloudfunctions.net/generateOpinions` (`index.html`의 `API_URL`) |
| 모델 | `claude-opus-5-5`, 구조화 출력(JSON 스키마)으로 형식 고정, 거절 시 서버 측 대체 모델 사용 |
| 허용 주소(CORS) | `https://echoeun-glitch.github.io`, `localhost:5000/8080` (`functions/lib.js`의 `ALLOWED_ORIGINS`) |
| 사용 한도 | 사용자(IP)당 하루 30회, 전체 하루 300회 (한국 시간 기준, 바꿀 수 있음) |

요청과 응답:

```
POST /generateOpinions
{"subject":"체육","grade":"5학년","name":"표현","activity":"리듬 줄넘기","criteria":"…"}

200 {"text":"{\"최상\":[…8개],\"상\":[…],\"중\":[…],\"하\":[…]}","remaining":29}
4xx/5xx {"message":"사용자에게 보여 줄 안내"}   (429 = 오늘 한도 초과)
```

### 처음 배포하기

준비물: Node.js 22, Firebase CLI, Blaze(종량제) 요금제의 Firebase 프로젝트, [Claude API 키](https://platform.claude.com/settings/keys).

```bash
npm install -g firebase-tools
firebase login
```

```bash
cd functions && npm install && cd ..
```

Claude API 키를 Secret Manager에 저장합니다(입력 창에 키를 붙여 넣음). 키는 코드나 저장소에 넣지 않습니다.

```bash
firebase functions:secrets:set ANTHROPIC_API_KEY
```

배포합니다. 처음에는 하루 한도(`DAILY_LIMIT_PER_USER`, `DAILY_LIMIT_TOTAL`)를 물어보며, 엔터를 누르면 기본값(30, 300)이 들어갑니다.

```bash
firebase deploy --only functions:evaluation-helper
```

배포가 끝나면 출력된 함수 주소가 `index.html`의 `API_URL`과 같은지 확인합니다.

같은 프로젝트의 다른 함수는 `codebase`가 달라 이 배포로 지워지거나 바뀌지 않습니다.

### 그 밖의 설정

- **한도 바꾸기:** `functions/.env`에 `DAILY_LIMIT_PER_USER=50`처럼 적고 다시 배포합니다.
- **사용 기록 자동 삭제:** Firestore 콘솔 → TTL 정책에서 컬렉션 `evaluationHelperUsage`, 필드 `expireAt`으로 정책을 만들면 3일 지난 기록이 지워집니다.
- **비용 상한:** Claude Console에서 월 사용 한도를, Google Cloud에서 예산 알림을 설정해 두세요.
- **로그 보기:** `firebase functions:log --only generateOpinions`

### 테스트

```bash
cd functions && npm test
```
