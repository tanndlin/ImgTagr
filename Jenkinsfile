def setStatus(String state, String description) {
    // Shell expands $GITHUB_TOKEN so the secret is not interpolated by Groovy
    sh """
    curl -L \\
    -X POST \\
    -H "Accept: application/vnd.github+json" \\
    -H "Authorization: Bearer \$GITHUB_TOKEN" \\
    -H "X-GitHub-Api-Version: 2022-11-28" \\
    https://api.github.com/repos/tanndlin/ImgTagr/statuses/\$GIT_COMMIT \\
    -d '{"state":"${state}","description":"${description}","context":"Jenkins"}'
    """
}

pipeline {
    agent any

    environment {
        GITHUB_TOKEN = credentials('GITHUB_TOKEN')
        DOCKER_VOLS = '-v jenkins_jenkins_home:/var/jenkins_home -v cargo-registry-cache:/usr/local/cargo/registry -v npm-cache:/root/.npm'
        NODE_IMAGE = 'node:24'
        RUST_IMAGE = 'rust:latest'
    }

    stages {
        stage('Checkout') {
            steps {
                checkout scm
                setStatus('pending', 'Build in progress')
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

        stage('Deploy') {
            when {
                allOf {
                    expression { env.GIT_BRANCH == 'master' || env.GIT_BRANCH == 'origin/master' }
                    expression { currentBuild.currentResult == 'SUCCESS' }
                }
            }
            environment {
                DB_PORT = '5434'
                API_PORT = '3006'
                WEB_PORT = '3007'
                S3_DATA = '/media/hdd/media/ImgTagr'
            }
            steps {
                sh 'docker compose -f docker-compose.yml -f docker-compose.deploy.yml -p imgtagr up -d --build --remove-orphans'
            }
        }
    }

    post {
        success {
            setStatus('success', 'Build succeeded')
        }
        failure {
            setStatus('failure', 'Build failed')
        }
    }
}
