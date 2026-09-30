pipeline {
    agent any

    environment {
        GITHUB_TOKEN = credentials('GITHUB_TOKEN')
        DOCKER_VOLS = '-v jenkins_jenkins_home:/var/jenkins_home -v cargo-registry-cache:/usr/local/cargo/registry'
        NODE_IMAGE = 'node:24'
        RUST_IMAGE = 'rust:latest'
    }

    stages {
        stage('Checkout') {
            steps {
                checkout scm
                sh '''
                curl -L \
                -X POST \
                -H "Accept: application/vnd.github+json" \
                -H "Authorization: Bearer $GITHUB_TOKEN" \
                -H "X-GitHub-Api-Version: 2022-11-28" \
                https://api.github.com/repos/tanndlin/ImgTagr/statuses/$GIT_COMMIT \
                -d '{"state":"pending","description":"Build in progress","context":"Jenkins"}'
                '''
            }
        }

        stage('Install & Build Frontend') {
            steps {
                sh '''
                docker run --rm $DOCKER_VOLS -w $WORKSPACE/frontend $NODE_IMAGE \
                    sh -c "npm ci && npm run build"
                '''
            }
        }

        stage('Lint Frontend') {
            steps {
                catchError(buildResult: 'FAILURE', stageResult: 'FAILURE') {
                    sh '''
                    docker run --rm $DOCKER_VOLS -w $WORKSPACE/frontend $NODE_IMAGE \
                        sh -c "npm run lint"
                    '''
                }
            }
        }

        stage('Lint Backend') {
            steps {
                catchError(buildResult: 'FAILURE', stageResult: 'FAILURE') {
                    sh '''
                    docker run --rm $DOCKER_VOLS -w $WORKSPACE/api $RUST_IMAGE \
                        sh -c "rustup component add clippy && cargo clippy --all-targets -- -D warnings"
                    '''
                }
            }
        }

        stage('Format Backend') {
            steps {
                catchError(buildResult: 'FAILURE', stageResult: 'FAILURE') {
                    sh '''
                    docker run --rm $DOCKER_VOLS -w $WORKSPACE/api $RUST_IMAGE \
                        sh -c "rustup component add rustfmt && cargo fmt -- --check"
                    '''
                }
            }
        }

        stage('Build Backend') {
            steps {
                sh '''
                docker run --rm $DOCKER_VOLS -w $WORKSPACE/api $RUST_IMAGE \
                    sh -c "cargo build --release"
                '''
            }
        }

        stage('Test Backend') {
            steps {
                sh '''
                docker run --rm $DOCKER_VOLS -w $WORKSPACE/api $RUST_IMAGE \
                    sh -c "cargo test"
                '''
            }
        }

        stage('Build Docker Images') {
            when {
                expression { env.GIT_BRANCH == 'master' || env.GIT_BRANCH == 'origin/master' }
            }
            steps {
                sh '''
                docker build -t imgtagr-api:$GIT_COMMIT ./api
                docker build -t imgtagr-frontend:$GIT_COMMIT ./frontend
                '''
            }
        }
    }

    post {
        success {
            sh '''
            curl -L \
            -X POST \
            -H "Accept: application/vnd.github+json" \
            -H "Authorization: Bearer $GITHUB_TOKEN" \
            -H "X-GitHub-Api-Version: 2022-11-28" \
            https://api.github.com/repos/tanndlin/ImgTagr/statuses/$GIT_COMMIT \
            -d '{"state":"success","description":"Build succeeded","context":"Jenkins"}'
            '''
        }
        failure {
            sh '''
            curl -L \
            -X POST \
            -H "Accept: application/vnd.github+json" \
            -H "Authorization: Bearer $GITHUB_TOKEN" \
            -H "X-GitHub-Api-Version: 2022-11-28" \
            https://api.github.com/repos/tanndlin/ImgTagr/statuses/$GIT_COMMIT \
            -d '{"state":"failure","description":"Build failed","context":"Jenkins"}'
            '''
        }
    }
}
