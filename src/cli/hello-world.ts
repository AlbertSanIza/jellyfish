import { Command } from 'commander'

export const helloWorldCommand = new Command('hello-world').description('Just somthing to test the CLI').action(() => {
    console.log('Hello, World!')
})
