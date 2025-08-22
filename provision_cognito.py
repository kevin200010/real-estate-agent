import boto3


def main():
    """Create a Cognito user pool and app client with no secret."""
    cognito = boto3.client('cognito-idp')
    pool = cognito.create_user_pool(
        PoolName='RealEstateUsers',
        AutoVerifiedAttributes=['email'],
    )
    client = cognito.create_user_pool_client(
        UserPoolId=pool['UserPool']['Id'],
        ClientName='real-estate-app',
        GenerateSecret=False,
        ExplicitAuthFlows=['ALLOW_USER_SRP_AUTH'],
    )
    print('UserPoolId:', pool['UserPool']['Id'])
    print('AppClientId:', client['UserPoolClient']['ClientId'])


if __name__ == '__main__':
    main()
